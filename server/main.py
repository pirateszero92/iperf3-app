import asyncio
import ipaddress
import json
import os
import re
import shlex
import socket
import time
import uuid
import ssl
import threading
from collections import deque, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union, List, Dict, Any

try:
    import dns.resolver
    import dns.reversename
    HAVE_DNSPYTHON = True
except ImportError:
    HAVE_DNSPYTHON = False

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
VLANS_FILE = DATA_DIR / "vlans.json"

DEFAULT_VLANS = [
    {
        "id": "vlan_10",
        "vlan_id": 10,
        "name": "Corporate Lab",
        "description": "Primary testing and R&D network",
        "color": "#00d4ff",
        "created_at": "2026-09-16T00:00:00Z",
    },
    {
        "id": "vlan_20",
        "vlan_id": 20,
        "name": "Servers & DMZ",
        "description": "Production server farm and service proxies",
        "color": "#a855f7",
        "created_at": "2026-09-16T00:00:00Z",
    },
    {
        "id": "vlan_30",
        "vlan_id": 30,
        "name": "Management",
        "description": "Network switches, routers, and ILO interfaces",
        "color": "#00e887",
        "created_at": "2026-09-16T00:00:00Z",
    },
]

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

def load_vlans() -> list:
    if VLANS_FILE.exists():
        try:
            with open(VLANS_FILE) as f:
                return json.load(f)
        except Exception:
            return []
    save_vlans(DEFAULT_VLANS)
    return DEFAULT_VLANS

def save_vlans(vlans: list) -> None:
    with open(VLANS_FILE, "w") as f:
        json.dump(vlans, f, indent=2)

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
    return {
        "mode": "full",
        "remote_port": int(os.environ.get("REMOTE_PORT", 8088)),
        "speedtest_port": int(os.environ.get("SPEEDTEST_PORT", 3002)),
    }

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
    "SSL/TLS Ciphers & Cert": "nmap -sV --script ssl-cert,ssl-enum-ciphers -p 443",
    "Service Banner Grab": "nmap -sV --script banner",
    "Safe Discovery Audit": 'nmap -sV --script "default and safe"',
    "HTTP Security Headers": "nmap -p 80,443 --script http-security-headers,http-methods",
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
                "ports": ports,
                "host_details": host_details,
                "output": "\n".join(lines[-2000:]),
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
# 5. IP Management (Subnet Scanner) & VLAN Management
# ===========================================================================

class VlanCreate(BaseModel):
    vlan_id: int
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#00d4ff"

class VlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class SubnetCreate(BaseModel):
    cidr: str
    name: Optional[str] = None
    vlan_id: Optional[int] = None

class SubnetMetaUpdate(BaseModel):
    name: Optional[str] = None
    vlan_id: Optional[int] = None

class AddressUpdate(BaseModel):
    ip: str
    system_name: Optional[str] = None
    machine_type: Optional[str] = None
    dns: Optional[str] = None

@app.get("/api/ipam/vlans")
def get_all_vlans():
    vlans = load_vlans()
    subnets = load_subnets()
    result = []
    for v in vlans:
        v_id = v["vlan_id"]
        assigned = [
            {"id": s["id"], "cidr": s["cidr"], "name": s.get("name", s["cidr"])}
            for s in subnets
            if s.get("vlan_id") == v_id
        ]
        result.append({
            **v,
            "assigned_subnets": assigned,
            "subnet_count": len(assigned),
        })
    return result

@app.post("/api/ipam/vlans")
def create_new_vlan(data: VlanCreate):
    if not (1 <= data.vlan_id <= 4094):
        raise HTTPException(status_code=400, detail="VLAN ID must be between 1 and 4094.")
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="VLAN Name is required.")

    vlans = load_vlans()
    if any(v["vlan_id"] == data.vlan_id for v in vlans):
        raise HTTPException(status_code=400, detail=f"VLAN {data.vlan_id} already exists.")

    new_vlan = {
        "id": f"vlan_{data.vlan_id}",
        "vlan_id": data.vlan_id,
        "name": data.name.strip(),
        "description": (data.description or "").strip(),
        "color": data.color or "#00d4ff",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    vlans.append(new_vlan)
    save_vlans(vlans)
    return new_vlan

@app.put("/api/ipam/vlans/{vlan_id}")
def update_existing_vlan(vlan_id: int, data: VlanUpdate):
    vlans = load_vlans()
    v = next((item for item in vlans if item["vlan_id"] == vlan_id), None)
    if not v:
        raise HTTPException(status_code=404, detail="VLAN not found")

    if data.name is not None:
        v["name"] = data.name.strip()
    if data.description is not None:
        v["description"] = data.description.strip()
    if data.color is not None:
        v["color"] = data.color.strip()

    save_vlans(vlans)
    return v

@app.delete("/api/ipam/vlans/{vlan_id}")
def delete_existing_vlan(vlan_id: int):
    vlans = load_vlans()
    vlans = [v for v in vlans if v["vlan_id"] != vlan_id]
    save_vlans(vlans)

    subnets = load_subnets()
    updated = False
    for s in subnets:
        if s.get("vlan_id") == vlan_id:
            s["vlan_id"] = None
            updated = True
    if updated:
        save_subnets(subnets)

    return {"status": "deleted", "vlan_id": vlan_id}

@app.get("/api/ipam/subnets")
def get_all_subnets():
    subnets = load_subnets()
    updated = False
    for s in subnets:
        if "vlan_id" not in s:
            if "corporate" in s.get("name", "").lower():
                s["vlan_id"] = 10
            else:
                s["vlan_id"] = None
            updated = True
    if updated:
        save_subnets(subnets)
    return subnets

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
        "vlan_id": data.vlan_id if data.vlan_id and data.vlan_id > 0 else None,
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

@app.put("/api/ipam/subnets/{subnet_id}/meta")
def update_subnet_metadata(subnet_id: str, data: SubnetMetaUpdate):
    subnets = load_subnets()
    sub = next((s for s in subnets if s.get("id") == subnet_id), None)
    if not sub:
        raise HTTPException(status_code=404, detail="Subnet not found")

    if data.name is not None:
        sub["name"] = data.name.strip()
    if data.vlan_id is not None:
        sub["vlan_id"] = data.vlan_id if data.vlan_id > 0 else None

    save_subnets(subnets)
    return sub

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
            m_ms = re.search(r"([\d\.]+\s*ms|< 1 ms)", prev_resp)
            if m_ms:
                addr["last_response"] = f"Prev ({m_ms.group(1)})"
            elif prev_resp in ["Today", "Yesterday"]:
                addr["last_response"] = "Prev (Recent)"
            else:
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


# ---------------------------------------------------------------------------
# IP Calculator & Subnet Divider Endpoints
# ---------------------------------------------------------------------------

class IpCalcRequest(BaseModel):
    cidr: str

class SubnetSplitRequest(BaseModel):
    cidr: str
    new_prefix: int

@app.post("/api/tools/ip-calc")
async def calculate_ip(req: IpCalcRequest):
    val = req.cidr.strip()
    if not val:
        raise HTTPException(status_code=400, detail="CIDR or IP address required")

    try:
        if "/" not in val:
            # Check if IPv6 or IPv4
            if ":" in val:
                val = f"{val}/64"
            else:
                val = f"{val}/24"

        # Try IPv4 network
        interface = ipaddress.ip_interface(val)
        ip = interface.ip
        net = interface.network

        if ip.version == 4:
            # Octets & binary
            ip_int = int(ip)
            net_int = int(net.network_address)
            mask_int = int(net.netmask)
            bcast_int = int(net.broadcast_address)
            wildcard_int = ~mask_int & 0xFFFFFFFF
            wildcard_mask = str(ipaddress.IPv4Address(wildcard_int))

            first_octet = int(str(ip).split('.')[0])
            if 1 <= first_octet <= 126:
                ip_class = "Class A"
            elif 128 <= first_octet <= 191:
                ip_class = "Class B"
            elif 192 <= first_octet <= 223:
                ip_class = "Class C"
            elif 224 <= first_octet <= 239:
                ip_class = "Class D (Multicast)"
            else:
                ip_class = "Class E (Experimental)"

            # Scope
            if ip.is_private:
                scope = "Private (RFC 1918)"
            elif ip.is_loopback:
                scope = "Loopback (127.0.0.0/8)"
            elif ip.is_link_local:
                scope = "Link-Local / APIPA (169.254.0.0/16)"
            elif ip.is_multicast:
                scope = "Multicast (RFC 5771)"
            elif ip in ipaddress.ip_network("100.64.0.0/10"):
                scope = "Carrier-Grade NAT / CGNAT (RFC 6598)"
            else:
                scope = "Public Internet"

            prefix = net.prefixlen
            total_hosts = net.num_addresses

            if prefix == 32:
                usable_hosts = 1
                first_usable = str(ip)
                last_usable = str(ip)
            elif prefix == 31:
                usable_hosts = 2
                first_usable = str(net.network_address)
                last_usable = str(net.broadcast_address)
            else:
                usable_hosts = max(0, total_hosts - 2)
                first_usable = str(net.network_address + 1)
                last_usable = str(net.broadcast_address - 1)

            return {
                "version": 4,
                "ip": str(ip),
                "cidr_prefix": prefix,
                "cidr_notation": f"{net.network_address}/{prefix}",
                "network_address": str(net.network_address),
                "broadcast_address": str(net.broadcast_address),
                "netmask": str(net.netmask),
                "wildcard_mask": wildcard_mask,
                "first_usable": first_usable,
                "last_usable": last_usable,
                "usable_hosts": usable_hosts,
                "total_addresses": total_hosts,
                "ip_class": ip_class,
                "scope": scope,
                "binary": {
                    "ip": f"{ip_int:032b}",
                    "netmask": f"{mask_int:032b}",
                    "network": f"{net_int:032b}",
                    "broadcast": f"{bcast_int:032b}",
                },
                "hex": f"0x{ip_int:08X}",
                "integer": ip_int,
            }

        else:
            # IPv6
            prefix = net.prefixlen
            subnets_64 = 0
            if prefix <= 64:
                subnets_64 = 2 ** (64 - prefix)

            scope = "Global Unicast"
            if ip.is_private or ip in ipaddress.ip_network("fc00::/7"):
                scope = "Unique Local (ULA - RFC 4193)"
            elif ip.is_link_local:
                scope = "Link-Local (fe80::/10)"
            elif ip.is_loopback:
                scope = "Loopback (::1)"
            elif ip.is_multicast:
                scope = "Multicast (ff00::/8)"

            return {
                "version": 6,
                "ip": str(ip),
                "cidr_prefix": prefix,
                "cidr_notation": f"{net.network_address}/{prefix}",
                "network_address": str(net.network_address),
                "compressed": ip.compressed,
                "exploded": ip.exploded,
                "scope": scope,
                "total_addresses": str(2 ** (128 - prefix)),
                "subnets_64": f"{subnets_64:,}" if subnets_64 > 0 else "N/A",
            }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid IP / CIDR format: {str(e)}")


@app.post("/api/tools/subnet-split")
async def split_subnet(req: SubnetSplitRequest):
    try:
        net = ipaddress.ip_network(req.cidr.strip(), strict=False)
        if req.new_prefix <= net.prefixlen:
            raise HTTPException(status_code=400, detail=f"New prefix /{req.new_prefix} must be greater than current /{net.prefixlen}")
        if req.new_prefix > (32 if net.version == 4 else 128):
            raise HTTPException(status_code=400, detail="Prefix exceeds maximum bits")

        count = 2 ** (req.new_prefix - net.prefixlen)
        if count > 256:
            raise HTTPException(status_code=400, detail=f"Cannot generate {count:,} subnets. Maximum display limit is 256 subnets.")

        subnets_gen = net.subnets(new_prefix=req.new_prefix)
        results = []
        for i, sub in enumerate(subnets_gen, 1):
            if net.version == 4:
                if sub.prefixlen == 32:
                    first_u, last_u, usable = str(sub.network_address), str(sub.network_address), 1
                elif sub.prefixlen == 31:
                    first_u, last_u, usable = str(sub.network_address), str(sub.broadcast_address), 2
                else:
                    first_u = str(sub.network_address + 1)
                    last_u = str(sub.broadcast_address - 1)
                    usable = max(0, sub.num_addresses - 2)

                results.append({
                    "index": i,
                    "cidr": str(sub),
                    "network": str(sub.network_address),
                    "netmask": str(sub.netmask),
                    "broadcast": str(sub.broadcast_address),
                    "first_usable": first_u,
                    "last_usable": last_u,
                    "usable_hosts": usable,
                    "total_hosts": sub.num_addresses,
                })
            else:
                results.append({
                    "index": i,
                    "cidr": str(sub),
                    "network": str(sub.network_address),
                    "total_hosts": str(2 ** (128 - sub.prefixlen)),
                })

        return {
            "parent_cidr": str(net),
            "new_prefix": req.new_prefix,
            "total_subnets": count,
            "subnets": results,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# SSL/TLS Certificate Analyzer
# ---------------------------------------------------------------------------

class SslInspectRequest(BaseModel):
    host: str
    port: Optional[int] = 443
    timeout: Optional[float] = 6.0

def _parse_x509_cert(der_bytes: bytes) -> dict:
    """Parse DER-encoded certificate using cryptography or fallback."""
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend
        from cryptography.x509.oid import NameOID, ExtensionOID

        cert = x509.load_der_x509_certificate(der_bytes, default_backend())

        def get_name(name):
            try:
                cn = name.get_attributes_for_oid(NameOID.COMMON_NAME)
                org = name.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
                c = name.get_attributes_for_oid(NameOID.COUNTRY_NAME)
                parts = []
                if cn: parts.append(cn[0].value)
                if org: parts.append(f"({org[0].value})")
                if c: parts.append(f"[{c[0].value}]")
                return " ".join(parts) if parts else str(name)
            except Exception:
                return str(name)

        subject = get_name(cert.subject)
        issuer = get_name(cert.issuer)

        # Subject Alternative Names (SANs)
        sans = []
        try:
            san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            for name in san_ext.value:
                sans.append(str(name.value))
        except Exception:
            pass

        # Dates
        not_before = cert.not_valid_before_utc if hasattr(cert, 'not_valid_before_utc') else cert.not_valid_before.replace(tzinfo=timezone.utc)
        not_after = cert.not_valid_after_utc if hasattr(cert, 'not_valid_after_utc') else cert.not_valid_after.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        days_remaining = (not_after - now).days
        is_expired = now > not_after

        # Key & Signature info
        sig_algo = cert.signature_algorithm_oid._name if hasattr(cert, 'signature_algorithm_oid') else "unknown"
        serial_hex = f"{cert.serial_number:X}"

        return {
            "subject": subject,
            "issuer": issuer,
            "sans": sans[:50],
            "valid_from": not_before.isoformat(),
            "valid_until": not_after.isoformat(),
            "days_remaining": days_remaining,
            "is_expired": is_expired,
            "signature_algorithm": sig_algo,
            "serial_number": serial_hex,
        }
    except Exception as e:
        return {"error": f"Failed to parse X.509 cert: {e}"}

@app.post("/api/ssl/inspect")
def inspect_ssl_certificate(req: SslInspectRequest):
    raw_host = req.host.strip()
    if not raw_host:
        raise HTTPException(status_code=400, detail="Host cannot be empty")

    port = req.port or 443
    if ":" in raw_host and not raw_host.startswith("["):
        parts = raw_host.rsplit(":", 1)
        raw_host = parts[0]
        try:
            port = int(parts[1])
        except ValueError:
            pass

    # Remove protocol prefix if user typed https://
    if "://" in raw_host:
        raw_host = raw_host.split("://", 1)[1]
    if "/" in raw_host:
        raw_host = raw_host.split("/", 1)[0]

    sni_hostname = raw_host
    # Check if IP address
    try:
        ipaddress.ip_address(raw_host)
        # IP addresses usually don't use SNI unless specified
    except ValueError:
        pass

    timeout = min(req.timeout or 6.0, 15.0)

    # Attempt 1: Verified SSL Context
    verified = True
    verify_error = None
    der_cert = None
    tls_version = None
    cipher_info = None
    alpn_proto = None

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        with socket.create_connection((raw_host, port), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=sni_hostname) as ssock:
                der_cert = ssock.getpeercert(binary_form=True)
                tls_version = ssock.version()
                cipher_info = ssock.cipher()
                alpn_proto = ssock.selected_alpn_protocol()
    except ssl.SSLCertVerificationError as e:
        verified = False
        verify_error = f"Certificate Verification Failed: {e.verify_message}"
    except Exception as e:
        verified = False
        verify_error = str(e)

    # Attempt 2: If verification failed, reconnect with unverified context to still parse certificate
    if not der_cert:
        try:
            unverified_ctx = ssl._create_unverified_context()
            unverified_ctx.check_hostname = False
            unverified_ctx.verify_mode = ssl.CERT_NONE
            with socket.create_connection((raw_host, port), timeout=timeout) as sock:
                with unverified_ctx.wrap_socket(sock, server_hostname=sni_hostname) as ssock:
                    der_cert = ssock.getpeercert(binary_form=True)
                    tls_version = ssock.version()
                    cipher_info = ssock.cipher()
                    alpn_proto = ssock.selected_alpn_protocol()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"SSL Handshake failed for {raw_host}:{port} - {e}")

    parsed = _parse_x509_cert(der_cert) if der_cert else {}

    days = parsed.get("days_remaining", 0)
    is_exp = parsed.get("is_expired", False)
    if is_exp:
        status = "expired"
        badge_color = "red"
    elif days <= 15:
        status = "critical_expiry"
        badge_color = "red"
    elif days <= 30:
        status = "expiring_soon"
        badge_color = "amber"
    else:
        status = "valid"
        badge_color = "green"

    return {
        "host": raw_host,
        "port": port,
        "verified": verified,
        "verify_error": verify_error,
        "status": status,
        "badge_color": badge_color,
        "tls_version": tls_version or "Unknown",
        "cipher": {
            "name": cipher_info[0] if cipher_info else "-",
            "version": cipher_info[1] if cipher_info else "-",
            "bits": cipher_info[2] if cipher_info else 0,
        },
        "alpn": alpn_proto or "-",
        "certificate": parsed,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Packet Capture & PCAP Export (tcpdump)
# ---------------------------------------------------------------------------

CAPTURES_DIR = DATA_DIR / "captures"
CAPTURES_DIR.mkdir(exist_ok=True)

active_captures: dict[str, dict] = {}

class CaptureStartRequest(BaseModel):
    interface: Optional[str] = "eth0"
    filter: Optional[str] = ""
    duration: Optional[int] = 30
    max_packets: Optional[int] = 2000

@app.get("/api/capture/interfaces")
def get_capture_interfaces():
    interfaces = []
    # Try reading /sys/class/net
    sys_net = Path("/sys/class/net")
    if sys_net.exists():
        for item in sys_net.iterdir():
            if item.is_dir() or item.is_symlink():
                operstate = "unknown"
                state_file = item / "operstate"
                if state_file.exists():
                    try:
                        operstate = state_file.read_text().strip()
                    except Exception:
                        pass
                interfaces.append({
                    "name": item.name,
                    "status": operstate,
                    "is_loopback": item.name == "lo",
                })
    if not interfaces:
        interfaces = [
            {"name": "eth0", "status": "up", "is_loopback": False},
            {"name": "any", "status": "pseudo", "is_loopback": False},
            {"name": "lo", "status": "up", "is_loopback": True},
        ]
    # Add 'any' pseudo interface if not present
    if not any(i["name"] == "any" for i in interfaces):
        interfaces.append({"name": "any", "status": "pseudo", "is_loopback": False})
    return interfaces

@app.post("/api/capture/start")
async def start_packet_capture(req: CaptureStartRequest):
    # Stop any already running capture
    for cap_id, cap_data in list(active_captures.items()):
        if cap_data.get("status") == "running":
            proc = cap_data.get("proc")
            if proc and proc.returncode is None:
                try: proc.terminate()
                except Exception: pass
            cap_data["status"] = "stopped"

    capture_id = str(uuid.uuid4())
    pcap_path = CAPTURES_DIR / f"capture_{capture_id[:8]}_{int(time.time())}.pcap"
    
    iface = req.interface or "eth0"
    duration = max(5, min(req.duration or 30, 300))  # 5s to 5 mins
    max_pkts = max(10, min(req.max_packets or 2000, 50000))
    bpf_filter = (req.filter or "").strip()

    cmd = ["tcpdump", "-i", iface, "-w", str(pcap_path), "-c", str(max_pkts), "-U"]
    if bpf_filter:
        cmd.extend(shlex.split(bpf_filter))

    raw_command = " ".join(cmd)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute tcpdump: {e}")

    cap_record = {
        "id": capture_id,
        "status": "running",
        "interface": iface,
        "filter": bpf_filter,
        "duration": duration,
        "max_packets": max_pkts,
        "file_path": str(pcap_path),
        "filename": pcap_path.name,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "command": raw_command,
        "proc": proc,
    }
    active_captures[capture_id] = cap_record

    # Background auto-stop task after duration
    async def _auto_stop():
        await asyncio.sleep(duration)
        if capture_id in active_captures and active_captures[capture_id]["status"] == "running":
            if proc.returncode is None:
                try: proc.terminate()
                except Exception: pass
            active_captures[capture_id]["status"] = "completed"

    asyncio.create_task(_auto_stop())

    return {
        "capture_id": capture_id,
        "filename": pcap_path.name,
        "command": raw_command,
        "status": "running",
        "duration": duration,
    }

@app.post("/api/capture/stop")
async def stop_packet_capture():
    stopped_id = None
    for cap_id, cap_data in active_captures.items():
        if cap_data.get("status") == "running":
            proc = cap_data.get("proc")
            if proc and proc.returncode is None:
                try: proc.terminate()
                except Exception: pass
            cap_data["status"] = "stopped"
            stopped_id = cap_id
    if not stopped_id:
        return {"status": "no_active_capture"}
    return {"status": "stopped", "capture_id": stopped_id}

@app.get("/api/capture/status")
def get_capture_status():
    running_cap = None
    for cap_id, cap_data in active_captures.items():
        if cap_data.get("status") == "running":
            proc = cap_data.get("proc")
            if proc and proc.returncode is not None:
                cap_data["status"] = "completed"
            else:
                running_cap = cap_data
                break

    if not running_cap:
        return {"active": False}

    file_size = 0
    fpath = Path(running_cap["file_path"])
    if fpath.exists():
        file_size = fpath.stat().st_size

    return {
        "active": True,
        "capture_id": running_cap["id"],
        "interface": running_cap["interface"],
        "filter": running_cap["filter"],
        "started_at": running_cap["started_at"],
        "duration": running_cap["duration"],
        "file_size": file_size,
        "filename": running_cap["filename"],
    }

@app.get("/api/capture/history")
def get_capture_history():
    files = []
    if CAPTURES_DIR.exists():
        for p in CAPTURES_DIR.glob("*.pcap"):
            stat = p.stat()
            files.append({
                "id": p.stem,
                "filename": p.name,
                "size_bytes": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files[:30]

@app.delete("/api/capture/{filename}")
def delete_capture_file(filename: str):
    p = CAPTURES_DIR / filename
    if p.exists() and p.name.endswith(".pcap"):
        try:
            p.unlink()
            return {"status": "deleted"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="Capture file not found")

@app.get("/api/capture/download/{filename}")
def download_capture_file(filename: str):
    p = CAPTURES_DIR / filename
    if not p.exists() or not p.name.endswith(".pcap"):
        raise HTTPException(status_code=404, detail="Capture file not found")
    return FileResponse(
        path=str(p),
        filename=filename,
        media_type="application/vnd.tcpdump.pcap"
    )


# ---------------------------------------------------------------------------
# Real-Time Traffic & Loop/Storm Analyzer (Ingestion + WebSocket)
# ---------------------------------------------------------------------------

ALERTS_FILE = DATA_DIR / "alerts.json"

def load_alerts() -> list:
    if ALERTS_FILE.exists():
        try:
            return json.loads(ALERTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []

def save_alerts(alerts: list):
    try:
        ALERTS_FILE.write_text(json.dumps(alerts[:200], ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

class TrafficTelemetryEngine:
    """In-Memory Packet Analyzer for Loop Detection, Storm Alerting, and Top Talkers."""
    def __init__(self):
        self.lock = threading.Lock()
        # Sliding window for loop detection: (ip_src, ip_dst, ip_id, ip_proto, tcp_seq) -> list of timestamps
        self.recent_signatures = {}
        # Sliding window for storm detection: src_key -> deque of timestamps
        self.packet_timestamps = defaultdict(deque)
        # Cooldown for alerts: key -> timestamp
        self.alert_cooldown = {}
        # Counters for current 1-second window
        self.current_bytes = 0
        self.current_packets = 0
        self.current_broadcast = 0
        self.current_multicast = 0
        self.talkers_bytes = defaultdict(int)
        self.rtt_samples = []
        self.retransmissions = 0
        # In-memory recent alerts buffer
        self.alerts = load_alerts()
        # Internal capture subprocess
        self.internal_proc = None
        self.internal_active = False

    def ingest_packet(self, data: dict):
        now = time.time()
        with self.lock:
            length = int(data.get("length") or data.get("frame_len") or 64)
            self.current_bytes += length
            self.current_packets += 1

            ip_src = data.get("ip_src") or data.get("src_ip") or ""
            ip_dst = data.get("ip_dst") or data.get("dst_ip") or ""
            eth_dst = data.get("eth_dst") or ""

            if ip_src:
                self.talkers_bytes[ip_src] += length

            is_bcast = False
            is_mcast = False
            if eth_dst.lower() == "ff:ff:ff:ff:ff:ff" or ip_dst.endswith(".255") or ip_dst == "255.255.255.255":
                self.current_broadcast += 1
                is_bcast = True
            elif eth_dst.lower().startswith("01:00:5e") or eth_dst.lower().startswith("33:33") or (ip_dst and ip_dst.startswith("224.") or ip_dst.startswith("239.")):
                self.current_multicast += 1
                is_mcast = True

            # RTT & Retransmission metrics
            rtt = data.get("rtt") or data.get("tcp_rtt")
            if rtt is not None:
                try: self.rtt_samples.append(float(rtt) * 1000) # convert to ms
                except Exception: pass
            if data.get("retransmission") or data.get("tcp_retransmit"):
                self.retransmissions += 1

            # 1. Loop Detection (duplicate packet signature within 500ms)
            ip_id = data.get("ip_id")
            ip_proto = data.get("ip_proto")
            tcp_seq = data.get("tcp_seq")
            if ip_src and ip_dst and ip_id is not None:
                sig_key = (ip_src, ip_dst, str(ip_id), str(ip_proto), str(tcp_seq or 0))
                sig_times = self.recent_signatures.get(sig_key, [])
                # Purge older than 0.5s
                sig_times = [t for t in sig_times if now - t <= 0.5]
                sig_times.append(now)
                self.recent_signatures[sig_key] = sig_times

                if len(sig_times) >= 3:
                    # Duplicate packet circulating
                    alert_key = f"loop_{ip_src}_{ip_dst}_{ip_id}"
                    if now - self.alert_cooldown.get(alert_key, 0) > 4.0:
                        self.alert_cooldown[alert_key] = now
                        self._trigger_alert({
                            "type": "Network Loop Detected",
                            "severity": "critical",
                            "message": f"Packet circulating repeatedly between {ip_src} and {ip_dst} (IP ID: {ip_id}, Count: {len(sig_times)})",
                            "source": ip_src,
                            "target": ip_dst,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })

            # 2. Storm Detection (Broadcast / Multicast or single src PPS > 100)
            src_key = ip_src or data.get("eth_src") or "unknown"
            q = self.packet_timestamps[src_key]
            q.append(now)
            while q and now - q[0] > 1.0:
                q.popleft()

            if len(q) > 120 and is_bcast:
                alert_key = f"storm_bcast_{src_key}"
                if now - self.alert_cooldown.get(alert_key, 0) > 5.0:
                    self.alert_cooldown[alert_key] = now
                    self._trigger_alert({
                        "type": "Broadcast Storm Detected",
                        "severity": "warning",
                        "message": f"High broadcast traffic from {src_key} ({len(q)} packets/sec)",
                        "source": src_key,
                        "target": "Broadcast",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
            elif len(q) > 200:
                alert_key = f"storm_unicast_{src_key}"
                if now - self.alert_cooldown.get(alert_key, 0) > 5.0:
                    self.alert_cooldown[alert_key] = now
                    self._trigger_alert({
                        "type": "Packet Storm / High PPS",
                        "severity": "warning",
                        "message": f"Abnormal packet surge from {src_key} ({len(q)} packets/sec)",
                        "source": src_key,
                        "target": ip_dst or "Multiple",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

    def _trigger_alert(self, alert_entry: dict):
        alert_entry["id"] = str(uuid.uuid4())[:8]
        self.alerts.insert(0, alert_entry)
        self.alerts = self.alerts[:100]
        save_alerts(self.alerts)
        # Broadcast alert
        asyncio.create_task(manager.broadcast("traffic_alerts", {"type": "new_alert", "alert": alert_entry}))

    def flush_metrics_snapshot(self) -> dict:
        with self.lock:
            pps = self.current_packets
            bps = self.current_bytes * 8
            mbps = round(bps / 1_000_000, 3)
            kbps = round(bps / 1_000, 1)

            bcast = self.current_broadcast
            mcast = self.current_multicast
            ucast = max(0, pps - bcast - mcast)

            # Top Talkers
            sorted_talkers = sorted(self.talkers_bytes.items(), key=lambda x: x[1], reverse=True)[:6]
            talkers_list = [{"ip": ip, "bytes": b, "mb": round(b / 1_000_000, 2)} for ip, b in sorted_talkers]

            avg_rtt = round(sum(self.rtt_samples) / len(self.rtt_samples), 2) if self.rtt_samples else 0.0
            retrans = self.retransmissions

            # Reset window counters
            self.current_bytes = 0
            self.current_packets = 0
            self.current_broadcast = 0
            self.current_multicast = 0
            self.rtt_samples = []
            self.retransmissions = 0

            # Prune old signatures
            now = time.time()
            self.recent_signatures = {k: v for k, v in self.recent_signatures.items() if v and now - v[-1] <= 1.0}

            return {
                "pps": pps,
                "bps": bps,
                "kbps": kbps,
                "mbps": mbps,
                "broadcast": bcast,
                "multicast": mcast,
                "unicast": ucast,
                "top_talkers": talkers_list,
                "avg_rtt_ms": avg_rtt,
                "tcp_retransmissions": retrans,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

traffic_engine = TrafficTelemetryEngine()

# Background TCP Socket Server on 0.0.0.0:9999 for host Tshark streaming
async def _start_traffic_socket_server():
    async def handle_client(reader, writer):
        addr = writer.get_extra_info('peername')
        try:
            while True:
                line_bytes = await reader.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode('utf-8', errors='replace').strip()
                if not line:
                    continue
                # Handle Tshark elasticsearch/json format or key-value
                try:
                    if line.startswith("{"):
                        data = json.loads(line)
                        layers = data.get("layers", data)
                        traffic_engine.ingest_packet({
                            "ip_src": layers.get("ip_src") or layers.get("ip.src", [None])[0] if isinstance(layers.get("ip.src"), list) else layers.get("ip.src"),
                            "ip_dst": layers.get("ip_dst") or layers.get("ip.dst", [None])[0] if isinstance(layers.get("ip.dst"), list) else layers.get("ip.dst"),
                            "ip_id": layers.get("ip_id") or layers.get("ip.id", [None])[0] if isinstance(layers.get("ip.id"), list) else layers.get("ip.id"),
                            "ip_proto": layers.get("ip_proto") or layers.get("ip.proto", [None])[0] if isinstance(layers.get("ip.proto"), list) else layers.get("ip.proto"),
                            "tcp_seq": layers.get("tcp_seq") or layers.get("tcp.seq", [None])[0] if isinstance(layers.get("tcp.seq"), list) else layers.get("tcp.seq"),
                            "eth_src": layers.get("eth_src") or layers.get("eth.src", [None])[0] if isinstance(layers.get("eth.src"), list) else layers.get("eth.src"),
                            "eth_dst": layers.get("eth_dst") or layers.get("eth.dst", [None])[0] if isinstance(layers.get("eth.dst"), list) else layers.get("eth.dst"),
                            "length": layers.get("frame_len") or layers.get("frame.len", [None])[0] if isinstance(layers.get("frame.len"), list) else layers.get("frame.len") or 64,
                            "rtt": layers.get("tcp_analysis_initial_rtt") or layers.get("tcp.analysis.initial_rtt", [None])[0] if isinstance(layers.get("tcp.analysis.initial_rtt"), list) else layers.get("tcp.analysis.initial_rtt"),
                            "retransmission": bool(layers.get("tcp_analysis_retransmission") or layers.get("tcp.analysis.retransmission")),
                        })
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            writer.close()
            try: await writer.wait_closed()
            except Exception: pass

    try:
        server = await asyncio.start_server(handle_client, '0.0.0.0', 9999)
        async with server:
            await server.serve_forever()
    except Exception as e:
        pass

# Background metrics broadcast task every 1 second
async def _traffic_metrics_loop():
    while True:
        await asyncio.sleep(1.0)
        try:
            snapshot = traffic_engine.flush_metrics_snapshot()
            await manager.broadcast("traffic_metrics", {"type": "metrics", "data": snapshot})
        except Exception:
            pass

# Start background workers on startup
@app.on_event("startup")
async def startup_traffic_workers():
    asyncio.create_task(_start_traffic_socket_server())
    asyncio.create_task(_traffic_metrics_loop())

@app.websocket("/ws/traffic")
async def traffic_websocket(websocket: WebSocket):
    await manager.connect("traffic_metrics", websocket)
    await manager.connect("traffic_alerts", websocket)
    try:
        # Send initial snapshot and recent alerts
        await websocket.send_json({
            "type": "init",
            "alerts": traffic_engine.alerts[:50],
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect("traffic_metrics", websocket)
        manager.disconnect("traffic_alerts", websocket)

@app.get("/api/traffic/alerts")
def get_traffic_alerts():
    return traffic_engine.alerts[:100]

@app.post("/api/traffic/alerts/clear")
def clear_traffic_alerts():
    traffic_engine.alerts = []
    save_alerts([])
    return {"status": "cleared"}

# Toggle internal container packet sniff (tcpdump piping to engine)
@app.post("/api/traffic/internal-sniff/toggle")
async def toggle_internal_sniff():
    if traffic_engine.internal_active and traffic_engine.internal_proc:
        try:
            traffic_engine.internal_proc.terminate()
        except Exception:
            pass
        traffic_engine.internal_active = False
        traffic_engine.internal_proc = None
        return {"active": False}

    # Start tcpdump on eth0
    try:
        cmd = ["tcpdump", "-i", "any", "-l", "-n", "-tt", "-q"]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL
        )
        traffic_engine.internal_proc = proc
        traffic_engine.internal_active = True

        async def _read_tcpdump():
            regex = re.compile(r"(\d+\.\d+)\s+IP\s+([\d\.]+)(?:\.\d+)?\s+>\s+([\d\.]+)(?:\.\d+)?:")
            while traffic_engine.internal_active and proc.stdout:
                line_b = await proc.stdout.readline()
                if not line_b:
                    break
                line = line_b.decode('utf-8', errors='replace').strip()
                m = regex.search(line)
                if m:
                    src = m.group(2)
                    dst = m.group(3)
                    traffic_engine.ingest_packet({
                        "ip_src": src,
                        "ip_dst": dst,
                        "ip_id": int(time.time() * 1000) % 65535,
                        "length": 128,
                    })

        asyncio.create_task(_read_tcpdump())
        return {"active": True}
    except Exception as e:
        traffic_engine.internal_active = False
        raise HTTPException(status_code=500, detail=f"Failed to start internal sniffer: {e}")

@app.get("/api/traffic/internal-sniff/status")
def get_internal_sniff_status():
    return {"active": traffic_engine.internal_active}



