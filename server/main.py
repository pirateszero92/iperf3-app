import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="iPerf3 Web GUI API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(exist_ok=True)
HISTORY_FILE = DATA_DIR / "history.json"

def load_history() -> list:
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(history: list) -> None:
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

# ---------------------------------------------------------------------------
# Global state (single-worker process only)
# ---------------------------------------------------------------------------

server_process: Optional[asyncio.subprocess.Process] = None
server_config: dict = {}
active_tests: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

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
# iPerf3 output parser
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
    """Return structured interval data for 1-second iperf3 output lines.
    Returns None for summary lines or lines that don't match."""
    if "sender" in line or "receiver" in line:
        return None  # final summary line — skip for live data

    m = _INTERVAL_RE.search(line)
    if not m:
        return None

    start, end = float(m.group("start")), float(m.group("end"))
    duration = end - start
    # Accept ~1-second intervals only; filter out end-of-test summaries
    if duration > 1.5:
        return None

    bw_f = float(m.group("bw")) * _BW_MULTIPLIERS.get(m.group("unit"), 1.0)

    return {
        "stream_id": m.group("id"),
        "interval_start": start,
        "interval_end": end,
        "bandwidth_mbps": round(bw_f, 2),
        "is_sum": m.group("id") == "SUM",
    }


def parse_summary(line: str) -> Optional[dict]:
    """Extract final summary bandwidth from sender/receiver lines."""
    if "sender" not in line and "receiver" not in line:
        return None
    m = _INTERVAL_RE.search(line)
    if not m:
        return None
    bw_f = float(m.group("bw")) * _BW_MULTIPLIERS.get(m.group("unit"), 1.0)
    return {
        "bandwidth_mbps": round(bw_f, 2),
        "is_sender": "sender" in line,
        "is_receiver": "receiver" in line,
    }

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ServerConfig(BaseModel):
    port: int = 5201
    bind_address: str = ""
    one_off: bool = False

class ClientConfig(BaseModel):
    host: str
    port: int = 5201
    protocol: str = "tcp"   # "tcp" | "udp"
    duration: int = 10
    parallel: int = 1
    reverse: bool = False
    bidir: bool = False
    bandwidth: str = ""     # UDP bandwidth, e.g. "100M"
    buffer_length: str = "" # Socket buffer length, e.g. "128K"

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

# ---------------------------------------------------------------------------
# Server Mode
# ---------------------------------------------------------------------------

@app.get("/api/server/status")
async def get_server_status():
    global server_process
    if server_process and server_process.returncode is None:
        return {"status": "running", "pid": server_process.pid, "config": server_config}
    return {"status": "stopped"}


@app.post("/api/server/start")
async def start_server(config: ServerConfig):
    global server_process, server_config

    if server_process and server_process.returncode is None:
        raise HTTPException(status_code=400, detail="Server is already running")

    cmd = ["iperf3", "-s", "-p", str(config.port), "--forceflush"]
    if config.bind_address:
        cmd += ["--bind", config.bind_address]
    if config.one_off:
        cmd.append("--one-off")

    server_process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    server_config = config.model_dump()

    asyncio.create_task(_stream_server(server_process))

    return {"status": "started", "pid": server_process.pid, "command": " ".join(cmd)}


@app.post("/api/server/stop")
async def stop_server():
    global server_process, server_config

    if not server_process or server_process.returncode is not None:
        raise HTTPException(status_code=400, detail="Server is not running")

    server_process.terminate()
    try:
        await asyncio.wait_for(server_process.wait(), timeout=5)
    except asyncio.TimeoutError:
        server_process.kill()

    server_process = None
    server_config = {}

    await manager.broadcast("server", {
        "type": "stopped",
        "message": "Server stopped by user",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": "stopped"}


async def _stream_server(proc: asyncio.subprocess.Process):
    """Read iperf3 server stdout and broadcast to WebSocket subscribers."""
    await manager.broadcast("server", {
        "type": "started",
        "message": "iPerf3 server is listening…",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    async for raw in proc.stdout:
        text = raw.decode(errors="replace").strip()
        if text:
            await manager.broadcast("server", {
                "type": "log",
                "message": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
    await manager.broadcast("server", {
        "type": "stopped",
        "message": "Server process ended",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@app.websocket("/ws/server")
async def server_ws(websocket: WebSocket):
    await manager.connect("server", websocket)
    # Send current status immediately on connect
    current = "running" if (server_process and server_process.returncode is None) else "stopped"
    await websocket.send_json({"type": "status", "status": current, "config": server_config})
    try:
        while True:
            await websocket.receive_text()  # keep connection alive
    except WebSocketDisconnect:
        manager.disconnect("server", websocket)

# ---------------------------------------------------------------------------
# Client Mode
# ---------------------------------------------------------------------------

@app.post("/api/client/run")
async def run_client(config: ClientConfig):
    test_id = str(uuid.uuid4())

    cmd = [
        "iperf3", "-c", config.host, "-p", str(config.port),
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
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    asyncio.create_task(_run_client_test(test_id, cmd, config))
    return {"test_id": test_id, "command": " ".join(cmd)}


async def _run_client_test(test_id: str, cmd: list, config: ClientConfig):
    """Execute iperf3 client and stream results via WebSocket."""
    active_tests[test_id]["status"] = "running"
    channel = f"client_{test_id}"

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # We accumulate both individual-stream intervals and SUM intervals.
        # SUM intervals are used for history/summary; individual intervals are
        # sent to the frontend so it can sum them itself for parallel tests.
        individual_intervals: list[dict] = []
        sum_intervals: list[dict] = []

        async for raw in proc.stdout:
            text = raw.decode(errors="replace").strip()
            if not text:
                continue

            await manager.broadcast(channel, {
                "type": "log",
                "message": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
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
            # Prefer SUM intervals for history (accurate for parallel streams)
            history_intervals = sum_intervals if sum_intervals else individual_intervals

            summary: dict = {}
            if history_intervals:
                bw_values = [i["bandwidth_mbps"] for i in history_intervals]
                summary = {
                    "avg_mbps": round(sum(bw_values) / len(bw_values), 2),
                    "max_mbps": round(max(bw_values), 2),
                    "min_mbps": round(min(bw_values), 2),
                }

            # Persist to history
            entry = {
                "id": test_id,
                "config": config.model_dump(),
                "command": " ".join(cmd),
                "intervals": history_intervals,
                "summary": summary,
                "started_at": active_tests[test_id]["started_at"],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            history = load_history()
            history.insert(0, entry)
            save_history(history[:100])  # keep last 100

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
            "command": active_tests[test_id].get("command", ""),
        })
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(f"client_{test_id}", websocket)

# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

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
