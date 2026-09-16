import asyncio
import ipaddress
import json
import os
import re
import shlex
import socket
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union, List

try:
    import dns.resolver
    import dns.reversename
    HAVE_DNSPYTHON = True
except ImportError:
    HAVE_DNSPYTHON = False

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
SUBNETS_FILE = DATA_DIR / "subnets.json"

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

def load_subnets() -> list:
    if SUBNETS_FILE.exists():
        try:
            with open(SUBNETS_FILE) as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_subnets(subnets: list) -> None:
    with open(SUBNETS_FILE, "w") as f:
        json.dump(subnets, f, indent=2)

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

class TraceConfig(BaseModel):
    host: str
    max_hops: int = 30
    protocol: str = "icmp" # "icmp" | "udp" | "tcp"
    probes: int = 3       # probes/repeat per hop
    task_id: Optional[str] = None
    cycle: Optional[int] = 1

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/api/mode")
async def get_app_mode():
    return {"mode": "full", "remote_port": int(os.environ.get("REMOTE_PORT", 8088))}

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
            stderr=asyncio.subprocess.STDOUT,
        )

        # We accumulate both individual-stream intervals and SUM intervals.
        # SUM intervals are used for history/summary; individual intervals are
        # sent to the frontend so it can sum them itself for parallel tests.
        individual_intervals: list[dict] = []
        sum_intervals: list[dict] = []
        last_log = "iperf3 exited with an error"

        async for raw in proc.stdout:
            text = raw.decode(errors="replace").strip()
            if not text:
                continue
            last_log = text

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
            active_tests[test_id]["status"] = "error"
            await manager.broadcast(channel, {"type": "error", "message": last_log})

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

# ---------------------------------------------------------------------------
# Route Trace (Traceroute)
# ---------------------------------------------------------------------------

_TRACE_LINE_RE = re.compile(r"^\s*(\d+)\s+(.+)$")
_IP_RE = re.compile(r"(?:\d{1,3}\.){3}\d{1,3}")
_RTT_RE = re.compile(r"([\d.]+)\s*ms")

def parse_trace_line(line: str) -> Optional[dict]:
    line = line.strip()
    m = _TRACE_LINE_RE.match(line)
    if not m:
        return None
    hop_num = int(m.group(1))
    rest = m.group(2)

    rest_clean = rest.replace("<1 ms", "0.5 ms").replace("<1ms", "0.5 ms")
    ip_match = _IP_RE.search(rest_clean)
    ip_str = ip_match.group(0) if ip_match else "*"

    rtts = [float(r) for r in _RTT_RE.findall(rest_clean)]
    avg_rtt = round(sum(rtts) / len(rtts), 2) if rtts else None

    return {
        "hop": hop_num,
        "ip": ip_str,
        "rtts": rtts,
        "rtt1": rtts[0] if len(rtts) > 0 else None,
        "rtt2": rtts[1] if len(rtts) > 1 else None,
        "rtt3": rtts[2] if len(rtts) > 2 else None,
        "avg_rtt": avg_rtt,
        "status": "success" if rtts else "timeout",
    }

active_traces: dict[str, dict] = {}

@app.post("/api/trace/run")
async def run_trace(config: TraceConfig):
    trace_id = str(uuid.uuid4())
    proto_flag = "-I" if config.protocol == "icmp" else ("-T" if config.protocol == "tcp" else "")
    cmd = ["stdbuf", "-oL", "traceroute"]
    if proto_flag:
        cmd.append(proto_flag)
    cmd += ["-q", str(config.probes), "-n", "-m", str(config.max_hops), "-w", "2", config.host]

    active_traces[trace_id] = {
        "config": config.model_dump(),
        "command": " ".join(cmd),
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    asyncio.create_task(_run_trace_task(trace_id, cmd, config))
    return {"trace_id": trace_id, "command": " ".join(cmd)}

async def _run_trace_task(trace_id: str, cmd: list, config: TraceConfig):
    channel = f"trace_{trace_id}"
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        if trace_id in active_traces:
            active_traces[trace_id]["proc"] = proc
        hops = []
        async for raw in proc.stdout:
            text = raw.decode(errors="replace").strip()
            if not text:
                continue
            await manager.broadcast(channel, {
                "type": "log",
                "message": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            parsed = parse_trace_line(text)
            if parsed:
                hops.append(parsed)
                await manager.broadcast(channel, {
                    "type": "hop",
                    "data": parsed,
                })
        await proc.wait()
        if trace_id in active_traces:
            active_traces[trace_id]["status"] = "complete"

        valid_rtts = [h["avg_rtt"] for h in hops if h.get("avg_rtt") is not None]
        trace_summary = {
            "total_hops": len(hops),
            "min_latency": min(valid_rtts) if valid_rtts else None,
            "target_latency": valid_rtts[-1] if valid_rtts else None,
        }

        # Save or update consolidated task in history
        try:
            history = load_history()
            record_id = config.task_id if config.task_id else trace_id
            existing_idx = next((i for i, item in enumerate(history) if item.get("id") == record_id), None)

            if existing_idx is not None:
                existing = history[existing_idx]
                prev_cycles = existing.get("cycles", 1)
                new_cycles = max(prev_cycles, config.cycle or (prev_cycles + 1))

                prev_summary = existing.get("summary", {})
                all_mins = [v for v in [prev_summary.get("min_latency"), trace_summary.get("min_latency")] if v is not None]

                existing["cycles"] = new_cycles
                existing["hops"] = hops
                existing["completed_at"] = datetime.now(timezone.utc).isoformat()
                existing["summary"] = {
                    "total_hops": len(hops),
                    "min_latency": min(all_mins) if all_mins else trace_summary.get("min_latency"),
                    "target_latency": trace_summary.get("target_latency"),
                    "cycles": new_cycles,
                }
                history[existing_idx] = existing
            else:
                entry = {
                    "id": record_id,
                    "type": "trace",
                    "task_id": config.task_id,
                    "cycles": config.cycle or 1,
                    "config": config.model_dump(),
                    "command": " ".join(cmd),
                    "hops": hops,
                    "summary": {
                        **trace_summary,
                        "cycles": config.cycle or 1,
                    },
                    "started_at": active_traces[trace_id]["started_at"],
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
                history.insert(0, entry)

            save_history(history[:100])
        except Exception:
            pass

        await manager.broadcast(channel, {
            "type": "complete",
            "hops": hops,
            "summary": trace_summary,
        })
    except Exception as exc:
        if trace_id in active_traces:
            active_traces[trace_id]["status"] = "error"
        await manager.broadcast(channel, {"type": "error", "message": str(exc)})

@app.websocket("/ws/trace/{trace_id}")
async def trace_ws(websocket: WebSocket, trace_id: str):
    await manager.connect(f"trace_{trace_id}", websocket)
    if trace_id in active_traces:
        await websocket.send_json({
            "type": "status",
            "status": active_traces[trace_id]["status"],
            "command": active_traces[trace_id].get("command", ""),
        })
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(f"trace_{trace_id}", websocket)

@app.post("/api/trace/stop/{trace_id}")
async def stop_trace_process(trace_id: str):
    if trace_id in active_traces:
        proc = active_traces[trace_id].get("proc")
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        active_traces[trace_id]["status"] = "stopped"
        return {"status": "stopped"}
    return {"status": "not_found"}


# ===========================================================================
# 4. Nmap Scanner (Zenmap-style GUI)
# ===========================================================================

active_nmap_scans: dict[str, dict] = {}

class NmapConfig(BaseModel):
    target: str
    profile: Optional[str] = "Quick scan"
    command_override: Optional[str] = None

NMAP_PROFILES = {
    "Intense scan": "nmap -T4 -A -v",
    "Intense scan plus UDP": "nmap -sS -sU -T4 -A -v",
    "Intense scan, all TCP ports": "nmap -p 1-65535 -T4 -A -v",
    "Intense scan, no ping": "nmap -T4 -A -v -Pn",
    "Ping scan": "nmap -sn",
    "Quick scan": "nmap -T4 -F",
    "Quick scan plus": "nmap -sV -T4 -O -F --version-light",
    "Quick traceroute": "nmap -sn --traceroute",
    "Regular scan": "nmap",
    "Slow comprehensive scan": 'nmap -sS -sU -T4 -A -v -PE -PP -PS80,443 -PA3389 -PU40125 -PY -g 53 --script "default or (discovery and safe)"',
    "Vulnerability scan": "nmap -sV --script vuln",
}

@app.get("/api/nmap/profiles")
def get_nmap_profiles():
    return NMAP_PROFILES

@app.post("/api/nmap/run")
async def run_nmap_scan(config: NmapConfig):
    target = config.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Target cannot be empty")

    scan_id = str(uuid.uuid4())
    raw_cmd = config.command_override.strip() if config.command_override else ""
    if not raw_cmd:
        base_flags = NMAP_PROFILES.get(config.profile, "nmap -T4 -F")
        raw_cmd = f"{base_flags} {target}"

    # Build argument array safely
    try:
        cmd_args = shlex.split(raw_cmd)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid command line: {e}")

    if not cmd_args or cmd_args[0] != "nmap":
        raise HTTPException(status_code=400, detail="Command must start with 'nmap'")

    active_nmap_scans[scan_id] = {
        "scan_id": scan_id,
        "target": target,
        "profile": config.profile,
        "command": raw_cmd,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "proc": None,
        "lines": [],
        "ports": [],
        "summary": {},
    }

    asyncio.create_task(_run_nmap_task(scan_id, cmd_args, raw_cmd, target, config.profile))
    return {"scan_id": scan_id, "command": raw_cmd}

async def _run_nmap_task(scan_id: str, cmd_args: list[str], raw_cmd: str, target: str, profile: str):
    channel = f"nmap_{scan_id}"
    lines = []
    ports = []
    host_details = {
        "state": "Unknown",
        "latency": "",
        "mac": "",
        "vendor": "",
        "os": "",
        "open_ports": 0,
        "closed_ports": 0,
        "filtered_ports": 0,
    }

    try:
        # Check if nmap exists, else warn
        proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        if scan_id in active_nmap_scans:
            active_nmap_scans[scan_id]["proc"] = proc

        port_regex = re.compile(r"^(\d+/(?:tcp|udp|sctp))\s+([a-zA-Z\|\-]+)\s+([\w\-\?]+)(?:\s+(.*))?$")
        in_ports_section = False

        while True:
            line_bytes = await proc.stdout.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            lines.append(line)

            # Check for header
            if "PORT" in line and "STATE" in line and "SERVICE" in line:
                in_ports_section = True
            elif in_ports_section and line.startswith("Nmap scan report") or line.startswith("Host script"):
                in_ports_section = False

            # Parse port line
            m_port = port_regex.match(line.strip())
            if m_port:
                port_data = {
                    "port": m_port.group(1),
                    "state": m_port.group(2),
                    "service": m_port.group(3),
                    "version": (m_port.group(4) or "").strip(),
                }
                # Check duplicate
                if not any(p["port"] == port_data["port"] for p in ports):
                    ports.append(port_data)
                    if port_data["state"] == "open":
                        host_details["open_ports"] += 1
                    elif port_data["state"] == "filtered":
                        host_details["filtered_ports"] += 1
                    elif port_data["state"] == "closed":
                        host_details["closed_ports"] += 1

                    await manager.broadcast(channel, {
                        "type": "port_found",
                        "port": port_data,
                    })

            # Check latency
            if "Host is up" in line:
                host_details["state"] = "Up"
                m_lat = re.search(r"\(([\d\.]+s) latency\)", line)
                if m_lat:
                    host_details["latency"] = m_lat.group(1)

            # Check MAC
            m_mac = re.search(r"MAC Address:\s*([0-9A-Fa-f:]+)(?:\s*\((.*?)\))?", line)
            if m_mac:
                host_details["mac"] = m_mac.group(1)
                host_details["vendor"] = m_mac.group(2) or ""

            # Check OS
            if line.startswith("OS details:") or line.startswith("Running:"):
                host_details["os"] = line.split(":", 1)[1].strip()

            await manager.broadcast(channel, {
                "type": "line",
                "line": line,
            })

        await proc.wait()

        if scan_id in active_nmap_scans:
            active_nmap_scans[scan_id]["status"] = "complete"
            active_nmap_scans[scan_id]["lines"] = lines
            active_nmap_scans[scan_id]["ports"] = ports
            active_nmap_scans[scan_id]["summary"] = host_details

        # Save to history
        try:
            history = load_history()
            entry = {
                "id": scan_id,
                "mode": "nmap",
                "target": target,
                "profile": profile,
                "command": raw_cmd,
                "ports_count": len(ports),
                "open_ports": host_details["open_ports"],
                "status": "complete",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
            history.insert(0, entry)
            save_history(history[:100])
        except Exception:
            pass

        await manager.broadcast(channel, {
            "type": "complete",
            "ports": ports,
            "host_details": host_details,
            "total_lines": len(lines),
        })

    except Exception as exc:
        if scan_id in active_nmap_scans:
            active_nmap_scans[scan_id]["status"] = "error"
        await manager.broadcast(channel, {
            "type": "error",
            "message": f"Nmap execution failed: {str(exc)}",
        })

@app.websocket("/ws/nmap/{scan_id}")
async def nmap_ws(websocket: WebSocket, scan_id: str):
    await manager.connect(f"nmap_{scan_id}", websocket)
    if scan_id in active_nmap_scans:
        await websocket.send_json({
            "type": "status",
            "status": active_nmap_scans[scan_id]["status"],
            "command": active_nmap_scans[scan_id].get("command", ""),
            "ports": active_nmap_scans[scan_id].get("ports", []),
        })
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(f"nmap_{scan_id}", websocket)

@app.post("/api/nmap/stop/{scan_id}")
async def stop_nmap_scan(scan_id: str):
    if scan_id in active_nmap_scans:
        proc = active_nmap_scans[scan_id].get("proc")
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        active_nmap_scans[scan_id]["status"] = "stopped"
        await manager.broadcast(f"nmap_{scan_id}", {"type": "stopped"})
        return {"status": "stopped"}
    return {"status": "not_found"}


# ===========================================================================
# 5. IP Management (Subnet Scanner)
# ===========================================================================

class SubnetCreate(BaseModel):
    cidr: str
    name: Optional[str] = None

class AddressUpdate(BaseModel):
    ip: str
    system_name: Optional[str] = None
    machine_type: Optional[str] = None
    dns: Optional[str] = None

@app.get("/api/ipam/subnets")
def get_all_subnets():
    return load_subnets()

@app.post("/api/ipam/subnets")
def create_new_subnet(data: SubnetCreate):
    cidr_str = data.cidr.strip()
    try:
        net = ipaddress.ip_network(cidr_str, strict=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CIDR notation: {e}")

    # Maximum 1024 addresses (/22) for performance
    if net.num_addresses > 1024:
        raise HTTPException(
            status_code=400,
            detail="Subnet size exceeds maximum limit of 1,024 addresses (/22)."
        )

    subnets = load_subnets()
    # Check if CIDR already exists
    for s in subnets:
        if s.get("cidr") == str(net):
            return s

    sub_id = f"sub_{int(time.time())}_{str(uuid.uuid4())[:4]}"
    net_addr = str(net.network_address)
    bcast_addr = str(net.broadcast_address) if net.num_addresses > 1 else ""

    addresses = []
    for ip in net:
        ip_str = str(ip)
        if ip_str == net_addr:
            status = "Subnet Address"
            last_resp = "Network"
        elif ip_str == bcast_addr:
            status = "Broadcast Address"
            last_resp = "Broadcast"
        else:
            status = "Available"
            last_resp = "Never"

        addresses.append({
            "ip": ip_str,
            "status": status,
            "is_online": False,
            "dns": "",
            "last_response": last_resp,
            "machine_type": "",
            "system_name": "",
        })

    usable = max(0, net.num_addresses - 2) if net.num_addresses > 2 else net.num_addresses
    new_sub = {
        "id": sub_id,
        "cidr": str(net),
        "network": net_addr,
        "netmask": str(net.netmask),
        "name": data.name or f"Subnet {net}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_scanned": None,
        "summary": {
            "total": usable,
            "used": 0,
            "available": usable,
        },
        "addresses": addresses,
    }

    subnets.append(new_sub)
    save_subnets(subnets)
    return new_sub

@app.delete("/api/ipam/subnets/{subnet_id}")
def remove_subnet(subnet_id: str):
    subnets = load_subnets()
    subnets = [s for s in subnets if s.get("id") != subnet_id]
    save_subnets(subnets)
    return {"status": "deleted"}

@app.post("/api/ipam/subnets/{subnet_id}/scan")
async def scan_subnet_endpoint(subnet_id: str):
    subnets = load_subnets()
    sub = next((s for s in subnets if s.get("id") == subnet_id), None)
    if not sub:
        raise HTTPException(status_code=404, detail="Subnet not found")

    cidr = sub["cidr"]
    alive_hosts: dict[str, dict] = {} # ip -> {latency, dns}

    # Attempt 1: Fast fping ICMP echo sweep (accurate, no false positives from TCP 443 proxy/firewall)
    try:
        proc = await asyncio.create_subprocess_exec(
            "fping", "-g", "-q", "-C", "1", "-t", "150", cidr,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        output = stdout.decode("utf-8", errors="replace")

        for line in output.splitlines():
            line_str = line.strip()
            if ":" in line_str:
                parts = [p.strip() for p in line_str.split(":", 1)]
                ip_part = parts[0]
                lat_part = parts[1]
                # If latency is a number (e.g. 9.37)
                if lat_part and lat_part != "-":
                    try:
                        val = float(lat_part)
                        alive_hosts[ip_part] = {
                            "latency": f"{val:.1f} ms",
                            "dns": "",
                        }
                    except ValueError:
                        alive_hosts[ip_part] = {
                            "latency": f"{lat_part} ms",
                            "dns": "",
                        }
    except Exception:
        pass

    # Attempt 2: If fping returned nothing, fallback to Nmap with ICMP-only (-PE --send-ip)
    if not alive_hosts:
        try:
            proc = await asyncio.create_subprocess_exec(
                "nmap", "-sn", "-PE", "--send-ip", cidr,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30.0)
            output = stdout.decode("utf-8", errors="replace")

            current_ip = None
            for line in output.splitlines():
                line_str = line.strip()
                m_rep = re.search(r"Nmap scan report for (?:([^\s]+)\s+\()?(\d+\.\d+\.\d+\.\d+)\)?", line_str)
                if m_rep:
                    hostname, ip_found = m_rep.group(1), m_rep.group(2)
                    current_ip = ip_found
                    dns_name = hostname if hostname and hostname != ip_found else ""
                    alive_hosts[current_ip] = {
                        "dns": dns_name,
                        "latency": "< 1 ms",
                    }
                elif current_ip and "Host is up" in line_str:
                    m_lat = re.search(r"\(([\d\.]+s) latency\)", line_str)
                    if m_lat:
                        try:
                            sec = float(m_lat.group(1).rstrip("s"))
                            alive_hosts[current_ip]["latency"] = f"{sec * 1000:.1f} ms"
                        except Exception:
                            alive_hosts[current_ip]["latency"] = m_lat.group(1)
        except Exception:
            pass

    # Reverse DNS resolution for alive hosts concurrently (up to 30)
    async def _resolve_dns(ip_addr: str):
        try:
            loop = asyncio.get_running_loop()
            h, _, _ = await asyncio.wait_for(
                loop.run_in_executor(None, socket.gethostbyaddr, ip_addr),
                timeout=0.8
            )
            return ip_addr, h
        except Exception:
            return ip_addr, ""

    ips_to_resolve = [ip for ip in alive_hosts.keys() if not alive_hosts[ip].get("dns")][:50]
    if ips_to_resolve:
        dns_results = await asyncio.gather(*[_resolve_dns(ip) for ip in ips_to_resolve], return_exceptions=True)
        for res in dns_results:
            if isinstance(res, tuple) and res[1]:
                alive_hosts[res[0]]["dns"] = res[1]

    # Update addresses in subnet while preserving system_name, custom notes, etc.
    used_count = 0
    for addr in sub["addresses"]:
        ip = addr["ip"]
        if ip == sub["network"] or addr.get("status") in ["Subnet Address", "Broadcast Address"]:
            continue

        if ip in alive_hosts:
            addr["status"] = "Used"
            addr["is_online"] = True
            if alive_hosts[ip].get("dns"):
                addr["dns"] = alive_hosts[ip]["dns"]
            addr["last_response"] = alive_hosts[ip].get("latency") or "Today"
            used_count += 1
        else:
            addr["is_online"] = False
            addr["status"] = "Available"
            prev_resp = str(addr.get("last_response", ""))
            if prev_resp.startswith("Prev ("):
                pass
            elif "ms" in prev_resp or prev_resp in ["Today", "< 1 ms"]:
                addr["last_response"] = f"Prev ({prev_resp})"
            elif not addr.get("last_response"):
                addr["last_response"] = "Never"

    total_usable = max(0, len(sub["addresses"]) - 2) if len(sub["addresses"]) > 2 else len(sub["addresses"])
    sub["summary"] = {
        "total": total_usable,
        "used": used_count,
        "available": max(0, total_usable - used_count),
    }
    sub["last_scanned"] = datetime.now(timezone.utc).isoformat()

    save_subnets(subnets)
    return sub

@app.put("/api/ipam/subnets/{subnet_id}/address")
def update_subnet_address(subnet_id: str, data: AddressUpdate):
    subnets = load_subnets()
    sub = next((s for s in subnets if s.get("id") == subnet_id), None)
    if not sub:
        raise HTTPException(status_code=404, detail="Subnet not found")

    for addr in sub["addresses"]:
        if addr["ip"] == data.ip:
            if data.system_name is not None:
                addr["system_name"] = data.system_name
            if data.machine_type is not None:
                addr["machine_type"] = data.machine_type
            if data.dns is not None:
                addr["dns"] = data.dns
            save_subnets(subnets)
            return addr

    raise HTTPException(status_code=404, detail="Address not found in subnet")


# ===========================================================================
# 6. DNS & WHOIS Suite
# ===========================================================================

class DnsLookupConfig(BaseModel):
    target: str
    record_type: Optional[str] = "ALL"
    nameserver: Optional[str] = None

class DnsResolveConfig(BaseModel):
    ips: List[str]

class WhoisConfig(BaseModel):
    target: str

@app.post("/api/dns/lookup")
async def dns_lookup_endpoint(config: DnsLookupConfig):
    target = config.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Target domain cannot be empty")

    types_to_query = (
        ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA"]
        if config.record_type.upper() == "ALL"
        else [config.record_type.upper()]
    )

    records = []
    t_start = time.perf_counter()

    # Query with dnspython if available
    if HAVE_DNSPYTHON:
        resolver = dns.resolver.Resolver()
        resolver.lifetime = 3.0
        if config.nameserver and config.nameserver.strip():
            resolver.nameservers = [config.nameserver.strip()]

        for rtype in types_to_query:
            try:
                answers = resolver.resolve(target, rtype)
                for rdata in answers:
                    val = str(rdata)
                    priority = getattr(rdata, "preference", None) or getattr(rdata, "priority", None)
                    records.append({
                        "type": rtype,
                        "name": str(answers.qname),
                        "value": val,
                        "ttl": answers.ttl,
                        "priority": priority,
                    })
            except Exception:
                pass

    latency_ms = round((time.perf_counter() - t_start) * 1000, 2)

    # Also capture raw query with dig command for detailed analysis
    raw_output = ""
    try:
        dig_args = ["dig"]
        if config.nameserver and config.nameserver.strip():
            dig_args.append(f"@{config.nameserver.strip()}")
        dig_args.extend([target, config.record_type if config.record_type != "ALL" else "ANY", "+stats"])
        
        proc = await asyncio.create_subprocess_exec(
            *dig_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        raw_output = stdout.decode("utf-8", errors="replace")

        # If dnspython was not available, extract basic answers from dig
        if not records:
            for line in raw_output.splitlines():
                line_str = line.strip()
                if line_str and not line_str.startswith(";") and not line_str.startswith("#"):
                    parts = re.split(r"\s+", line_str)
                    if len(parts) >= 5:
                        # name ttl class type data...
                        records.append({
                            "type": parts[3],
                            "name": parts[0],
                            "value": " ".join(parts[4:]),
                            "ttl": int(parts[1]) if parts[1].isdigit() else 300,
                            "priority": None,
                        })
    except Exception:
        if not raw_output:
            raw_output = f"Lookup completed for {target}. Found {len(records)} records."

    return {
        "target": target,
        "nameserver": config.nameserver or "System Default",
        "latency_ms": latency_ms,
        "records": records,
        "raw_output": raw_output,
    }

@app.post("/api/dns/resolve")
async def dns_resolve_endpoint(config: DnsResolveConfig):
    results = []
    ips = config.ips[:50] # cap at 50

    for ip in ips:
        ip = ip.strip()
        if not ip:
            continue
        t0 = time.perf_counter()
        hostname = ""
        status = "unresolved"
        try:
            h, _, _ = socket.gethostbyaddr(ip)
            hostname = h
            status = "resolved"
        except Exception:
            hostname = "-"

        latency = round((time.perf_counter() - t0) * 1000, 2)
        results.append({
            "ip": ip,
            "hostname": hostname,
            "status": status,
            "latency_ms": latency,
        })

    return {"results": results}

@app.post("/api/whois/query")
async def whois_query_endpoint(config: WhoisConfig):
    target = config.target.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Target cannot be empty")

    raw_output = ""
    parsed: dict[str, Union[str, list]] = {
        "domain": target,
        "registrar": "",
        "created_date": "",
        "expiry_date": "",
        "updated_date": "",
        "status": "",
        "organization": "",
        "name_servers": [],
        "asn": "",
        "cidr": "",
    }

    try:
        proc = await asyncio.create_subprocess_exec(
            "whois", target,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=8.0)
        raw_output = stdout.decode("utf-8", errors="replace")

        ns_list = []
        for line in raw_output.splitlines():
            line_clean = line.strip()
            if ":" not in line_clean:
                continue
            key, val = [p.strip() for p in line_clean.split(":", 1)]
            k_lower = key.lower()

            if "registrar" in k_lower and not parsed["registrar"] and "url" not in k_lower:
                parsed["registrar"] = val
            elif any(d in k_lower for d in ["creation date", "created", "registration time"]):
                if not parsed["created_date"]:
                    parsed["created_date"] = val
            elif any(d in k_lower for d in ["registry expiry date", "expiration date", "expiry", "expire"]):
                if not parsed["expiry_date"]:
                    parsed["expiry_date"] = val
            elif any(d in k_lower for d in ["updated date", "last updated", "changed"]):
                if not parsed["updated_date"]:
                    parsed["updated_date"] = val
            elif "status" in k_lower and not parsed["status"]:
                parsed["status"] = val.split()[0]
            elif any(o in k_lower for o in ["org-name", "organization", "registrant organization", "descr"]):
                if not parsed["organization"]:
                    parsed["organization"] = val
            elif any(ns in k_lower for ns in ["name server", "nserver"]):
                ns_val = val.lower().split()[0]
                if ns_val and ns_val not in ns_list:
                    ns_list.append(ns_val)
            elif "origin" in k_lower or "asn" in k_lower:
                if not parsed["asn"]:
                    parsed["asn"] = val
            elif "cidr" in k_lower or "inetnum" in k_lower:
                if not parsed["cidr"]:
                    parsed["cidr"] = val

        parsed["name_servers"] = ns_list
    except Exception as e:
        raw_output = f"Whois query error: {str(e)}"

    return {
        "target": target,
        "parsed": parsed,
        "raw_output": raw_output,
    }

