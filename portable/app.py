import asyncio
import json
import os
import re
import sys
import socket
import webbrowser
import uuid
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="iPerf3 Web GUI - Portable Client", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Path Helper for PyInstaller
# ---------------------------------------------------------------------------

def get_resource_path(relative_path: str) -> Path:
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = Path(sys._MEIPASS)
    except Exception:
        base_path = Path(__file__).resolve().parent

    return base_path / relative_path

# Locate bundled iperf3.exe
IPERF3_DIR = get_resource_path("bin")
IPERF3_PATH = IPERF3_DIR / "iperf3.exe"

# If in development and portable/bin doesn't exist, fallback to workspace relative
if not IPERF3_PATH.exists():
    IPERF3_PATH = Path(__file__).resolve().parent.parent / "portable" / "bin" / "iperf3.exe"

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

# Save history to local directory where the exe is run from
RUN_DIR = Path(sys.argv[0]).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
HISTORY_FILE = RUN_DIR / "iperf3_history.json"

def load_history() -> list:
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(history: list) -> None:
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, indent=2)
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Global State & WS Manager
# ---------------------------------------------------------------------------

active_tests: dict[str, dict] = {}

class ConnectionManager:
    def __init__(self):
        self.channels: dict[str, list[WebSocket]] = {}

    async def connect(self, channel: str, ws: WebSocket):
        await ws.accept()
        self.channels.setdefault(channel, []).append(ws)

    def disconnect(self, channel: str, ws: WebSocket):
        if channel in self.channels:
            try:
                self.channels[channel].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, channel: str, message: dict):
        if channel not in self.channels:
            return
        dead: list[WebSocket] = []
        for ws in self.channels[channel][:]:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(channel, ws)

manager = ConnectionManager()

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

_INTERVAL_RE = re.compile(
    r"\[\s*(?P<id>\d+|SUM)\]\s+"
    r"(?P<start>[\d.]+)-(?P<end>[\d.]+)\s+sec\s+"
    r"[\d.]+\s+\w+Bytes\s+"
    r"(?P<bw>[\d.]+)\s+(?P<unit>(?:K|M|G)?bits/sec)"
)

_BW_MULTIPLIERS = {
    "bits/sec": 1 / 1_000_000,
    "Kbits/sec": 1 / 1_000,
    "Mbits/sec": 1,
    "Gbits/sec": 1_000,
}

def parse_interval(line: str) -> Optional[dict]:
    if "sender" in line or "receiver" in line:
        return None
    m = _INTERVAL_RE.search(line)
    if not m:
        return None
    start, end = float(m.group("start")), float(m.group("end"))
    if (end - start) > 1.5:
        return None
    bw_f = float(m.group("bw")) * _BW_MULTIPLIERS.get(m.group("unit"), 1.0)
    return {
        "stream_id": m.group("id"),
        "interval_start": start,
        "interval_end": end,
        "bandwidth_mbps": round(bw_f, 2),
        "is_sum": m.group("id") == "SUM",
    }

# ---------------------------------------------------------------------------
# Models & APIs
# ---------------------------------------------------------------------------

class ClientConfig(BaseModel):
    host: str
    port: int = 5201
    protocol: str = "tcp"
    duration: int = 10
    parallel: int = 1
    reverse: bool = False
    bidir: bool = False
    bandwidth: str = ""
    buffer_length: str = ""

@app.get("/api/health")
async def health():
    return {"status": "ok", "iperf3_exists": IPERF3_PATH.exists()}

# Stub for server status since portable is client-only
@app.get("/api/server/status")
async def get_server_status():
    return {"status": "stopped"}

@app.websocket("/ws/server")
async def server_ws(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"type": "status", "status": "stopped", "config": {}})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass

@app.post("/api/client/run")
async def run_client(config: ClientConfig):
    if not IPERF3_PATH.exists():
        raise HTTPException(status_code=500, detail=f"Bundled iperf3.exe not found at {IPERF3_PATH}")

    test_id = str(uuid.uuid4())
    cmd = [
        str(IPERF3_PATH), "-c", config.host, "-p", str(config.port),
        "-t", str(config.duration), "-i", "1", "--forceflush",
    ]
    if config.protocol == "udp":
        cmd.append("-u")
        if config.bandwidth:
            cmd += ["-b", config.bandwidth]
    if config.parallel > 1:
        cmd += ["-P", str(config.parallel)]
    if config.reverse:
        cmd.append("-R")
    elif config.bidir:
        cmd.append("--bidir")
    if config.buffer_length:
        cmd += ["-l", config.buffer_length]

    active_tests[test_id] = {
        "config": config.model_dump(),
        "command": " ".join(cmd),
        "status": "pending",
        "started_at": datetime.utcnow().isoformat(),
    }
    asyncio.create_task(_run_client_test(test_id, cmd, config))
    # Return formatted command for display, hiding full exe path
    display_cmd = ["iperf3"] + cmd[1:]
    return {"test_id": test_id, "command": " ".join(display_cmd)}

async def _run_client_test(test_id: str, cmd: list, config: ClientConfig):
    active_tests[test_id]["status"] = "running"
    channel = f"client_{test_id}"

    # Ensure Cygwin / iperf3 runs correctly by passing system PATH / environment
    env = os.environ.copy()
    env["PATH"] = f"{IPERF3_DIR};{env.get('PATH', '')}"

    try:
        # Hide console window on Windows when spawning subprocess in PyInstaller
        startupinfo = None
        if os.name == 'nt':
            startupinfo = asyncio.subprocess.STARTUPINFO()
            startupinfo.dwFlags |= asyncio.subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = asyncio.subprocess.SW_HIDE

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            startupinfo=startupinfo,
        )

        individual_intervals: list[dict] = []
        sum_intervals: list[dict] = []

        async for raw in proc.stdout:
            text = raw.decode(errors="replace").strip()
            if not text:
                continue

            await manager.broadcast(channel, {
                "type": "log",
                "message": text,
                "timestamp": datetime.utcnow().isoformat(),
            })

            parsed = parse_interval(text)
            if parsed:
                if parsed["is_sum"]:
                    sum_intervals.append(parsed)
                else:
                    individual_intervals.append(parsed)
                    await manager.broadcast(channel, {
                        "type": "interval",
                        "data": {
                            "stream_id": parsed["stream_id"],
                            "interval_start": parsed["interval_start"],
                            "interval_end": parsed["interval_end"],
                            "bandwidth_mbps": parsed["bandwidth_mbps"],
                        },
                    })

        stderr_bytes = await proc.stderr.read()
        await proc.wait()

        if proc.returncode == 0:
            history_intervals = sum_intervals if sum_intervals else individual_intervals
            summary = {}
            if history_intervals:
                bw_values = [i["bandwidth_mbps"] for i in history_intervals]
                summary = {
                    "avg_mbps": round(sum(bw_values) / len(bw_values), 2),
                    "max_mbps": round(max(bw_values), 2),
                    "min_mbps": round(min(bw_values), 2),
                }

            entry = {
                "id": test_id,
                "config": config.model_dump(),
                "command": "iperf3 " + " ".join(cmd[1:]),
                "intervals": history_intervals,
                "summary": summary,
                "started_at": active_tests[test_id]["started_at"],
                "completed_at": datetime.utcnow().isoformat(),
            }
            history = load_history()
            history.insert(0, entry)
            save_history(history[:50])

            active_tests[test_id]["status"] = "complete"
            await manager.broadcast(channel, {
                "type": "complete",
                "summary": summary,
                "intervals": history_intervals,
            })
        else:
            err_msg = stderr_bytes.decode(errors="replace").strip() or "iperf3 exited with an error"
            active_tests[test_id]["status"] = "error"
            await manager.broadcast(channel, {"type": "error", "message": err_msg})

    except Exception as exc:
        active_tests[test_id]["status"] = "error"
        await manager.broadcast(channel, {"type": "error", "message": str(exc)})

@app.websocket("/ws/client/{test_id}")
async def client_ws(websocket: WebSocket, test_id: str):
    await manager.connect(f"client_{test_id}", websocket)
    if test_id in active_tests:
        await websocket.send_json({
            "type": "status",
            "status": active_tests[test_id]["status"],
            "command": "iperf3 " + " ".join(active_tests[test_id]["command"].split()[1:]),
        })
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(f"client_{test_id}", websocket)

@app.get("/api/history")
async def get_history():
    return load_history()

@app.delete("/api/history")
async def clear_history():
    save_history([])
    return {"status": "cleared"}

@app.delete("/api/history/{test_id}")
async def delete_history_entry(test_id: str):
    history = [h for h in load_history() if h["id"] != test_id]
    save_history(history)
    return {"status": "deleted"}

# ---------------------------------------------------------------------------
# Static UI Mounting (Vite frontend build output)
# ---------------------------------------------------------------------------

dist_path = get_resource_path("dist")
if dist_path.exists():
    app.mount("/", StaticFiles(directory=str(dist_path), html=True), name="static")

# ---------------------------------------------------------------------------
# Portable App Startup
# ---------------------------------------------------------------------------

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def main():
    port = find_free_port()
    url = f"http://localhost:{port}"
    print("=" * 60)
    print(" iPerf3 Web GUI - Portable Client running...")
    print(f" Web Interface: {url}")
    print(" Close this window/press Ctrl+C to exit.")
    print("=" * 60)

    # Open user's default browser after 1.5 seconds in a background thread
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

if __name__ == "__main__":
    main()
