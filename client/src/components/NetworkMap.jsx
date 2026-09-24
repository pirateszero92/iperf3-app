import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'

const NODE_WIDTH = 200
const NODE_HEIGHT = 90

// ── Isolated Dagre Layout Function ───────────────────────────────────────
function getLayoutedElements(nodes, edges, direction = 'LR') {
  if (!nodes || nodes.length === 0) return { nodes: [], edges: [] }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  })

  nodes.forEach(n => {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })

  edges.forEach(e => {
    if (nodes.some(n => n.id === e.source) && nodes.some(n => n.id === e.target)) {
      g.setEdge(e.source, e.target)
    }
  })

  dagre.layout(g)

  const isHorizontal = direction === 'LR'
  const layouted = nodes.map(n => {
    const pos = g.node(n.id) || { x: 100, y: 100 }
    return {
      ...n,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: layouted, edges }
}

// ── Edge Color & Width ───────────────────────────────────────────────────
function getEdgeColor(data) {
  if (data?.status === 'down' || data?.status === 'timeout') return '#ff4466'
  const lat = data?.latency_ms
  if (lat == null) return '#6b7a99'
  if (lat < 20) return '#00e887'
  if (lat < 80) return '#00d4ff'
  if (lat < 150) return '#ffbb00'
  return '#ff4466'
}

function getEdgeWidth(data) {
  const bw = data?.bandwidth_mbps
  if (bw == null) return 2
  if (bw >= 1000) return 5
  if (bw >= 100) return 4
  if (bw >= 10) return 3
  return 2
}

// ── Custom Node ──────────────────────────────────────────────────────────
function MapNode({ data, selected }) {
  const typeIcon = {
    local: '💻',
    gateway: '🌐',
    host: '🖥️',
    router: '📡',
    unknown: '❓',
  }[data.type] || '●'

  const borderColor = data.type === 'gateway'
    ? (data.vlan_color || '#00d4ff')
    : data.type === 'local'
    ? '#a855f7'
    : data.status === 'up'
    ? '#00e887'
    : data.status === 'down'
    ? '#ff4466'
    : '#6b7a99'

  const latencyText =
    data.latency_ms != null ? `${data.latency_ms.toFixed(1)} ms` :
    data.last_response && data.last_response !== 'Never' ? data.last_response :
    null

  const lossText = data.loss_percent != null && data.loss_percent > 0
    ? `${data.loss_percent.toFixed(1)}% loss` : null

  const trafficText = data.traffic_mb != null && data.traffic_mb > 0
    ? `${data.traffic_mb.toFixed(2)} MB` : null

  return (
    <div
      className="topo-node"
      style={{
        borderColor,
        boxShadow: selected
          ? `0 0 0 2px ${borderColor}, 0 0 22px ${borderColor}66`
          : `0 0 12px ${borderColor}22`,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: borderColor }} />
      <div className="topo-node-header">
        <span className="topo-node-icon">{typeIcon}</span>
        <span className="topo-node-label" title={data.label || data.ip}>
          {data.label || data.ip}
        </span>
      </div>
      {data.ip && data.ip !== data.label && (
        <div className="topo-node-ip">{data.ip}</div>
      )}
      <div className="topo-node-meta">
        {latencyText && <span className="topo-node-chip">{latencyText}</span>}
        {lossText && <span className="topo-node-chip topo-chip-bad">{lossText}</span>}
        {trafficText && <span className="topo-node-chip topo-chip-good">{trafficText}</span>}
        {data.vlan_id != null && (
          <span className="topo-node-chip topo-chip-vlan" style={{ color: data.vlan_color || '#00d4ff' }}>
            VLAN {data.vlan_id}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
    </div>
  )
}

// ── Custom Edge ──────────────────────────────────────────────────────────
function MetricEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style }) {
  const color = getEdgeColor(data || {})
  const width = getEdgeWidth(data || {})

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 8,
  })

  const parts = []
  if (data?.latency_ms != null) parts.push(`${data.latency_ms.toFixed(1)} ms`)
  if (data?.bandwidth_mbps != null) parts.push(`${data.bandwidth_mbps.toFixed(0)} Mbps`)
  if (data?.loss_percent > 0) parts.push(`${data.loss_percent.toFixed(1)}% loss`)
  if (data?.status === 'timeout') parts.push('timeout')
  const label = parts.join(' · ')

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: data?.status === 'timeout' ? '6 4' : 'none',
          ...style,
        }}
        markerEnd={{ type: MarkerType.ArrowClosed, color, width: 14, height: 14 }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              background: 'rgba(10, 15, 30, 0.94)',
              color: color,
              padding: '2px 7px',
              borderRadius: 4,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              whiteSpace: 'nowrap',
              border: `1px solid ${color}55`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { map: MapNode }
const edgeTypes = { metric: MetricEdge }

// ── Main Component ───────────────────────────────────────────────────────
export default function NetworkMap({ onNavigate }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const [sessionId, setSessionId] = useState(null)
  const [layoutDir, setLayoutDir] = useState('LR') // 'LR' | 'TB'
  const [subnets, setSubnets] = useState([])
  const [selectedSubnet, setSelectedSubnet] = useState('')
  const [traceTarget, setTraceTarget] = useState('8.8.8.8')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [monitorId, setMonitorId] = useState(null)
  const [monitorInterval, setMonitorInterval] = useState(10)
  const [selectedNode, setSelectedNode] = useState(null)
  const [wsStatus, setWsStatus] = useState('disconnected')
  const [toast, setToast] = useState(null)

  const wsRef = useRef(null)
  const reactFlowInstance = useRef(null)

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind })
  }, [])

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Load subnets on mount
  useEffect(() => {
    fetch('/api/ipam/subnets')
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : []
        setSubnets(list)
        if (list.length > 0 && !selectedSubnet) {
          setSelectedSubnet(list[0].id)
        }
      })
      .catch(() => {})
  }, [selectedSubnet])

  // ── Session Create ──
  const createSession = useCallback(async () => {
    try {
      const r = await fetch('/api/topology/session', { method: 'POST' })
      const d = await r.json()
      setSessionId(d.session_id)
      setNodes([])
      setEdges([])
      setSelectedNode(null)
      showToast(`Topology session ${d.session_id} initialized`, 'success')
      return d.session_id
    } catch {
      showToast('Failed to create topology session', 'error')
      return null
    }
  }, [showToast, setNodes, setEdges])

  // ── Auto-join or create session on mount ──
  useEffect(() => {
    fetch('/api/topology/sessions')
      .then(r => r.json())
      .then(sessions => {
        if (Array.isArray(sessions) && sessions.length > 0) {
          setSessionId(sessions[sessions.length - 1].session_id)
        } else {
          createSession()
        }
      })
      .catch(() => {
        createSession()
      })
  }, [createSession])

  // ── Session Delete / Clear ──
  const deleteSession = useCallback(async () => {
    if (!sessionId) return
    if (monitorId) {
      try {
        await fetch(`/api/topology/${sessionId}/monitor/stop`, { method: 'POST' })
      } catch {}
    }
    try {
      await fetch(`/api/topology/session/${sessionId}`, { method: 'DELETE' })
    } catch {}
    setMonitorId(null)
    setNodes([])
    setEdges([])
    setSelectedNode(null)
    createSession()
  }, [sessionId, monitorId, setNodes, setEdges, createSession])

  // ── WebSocket Connect ──
  useEffect(() => {
    if (!sessionId) {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setWsStatus('disconnected')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/topology/${sessionId}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')
    ws.onclose = () => setWsStatus('disconnected')
    ws.onerror = () => setWsStatus('error')

    ws.onmessage = (evt) => {
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }

      if (msg.type === 'snapshot') {
        const rNodes = (msg.data.nodes || []).map(n => ({
          id: n.id,
          type: 'map',
          data: { ...n },
          position: { x: 0, y: 0 },
        }))
        const rEdges = (msg.data.edges || []).map(e => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'metric',
          data: { ...e },
          animated: e.status === 'active' && e.latency_ms == null,
        }))
        const layouted = getLayoutedElements(rNodes, rEdges, layoutDir)
        setNodes(layouted.nodes)
        setEdges(layouted.edges)
        setTimeout(() => {
          if (reactFlowInstance.current && rNodes.length > 0) {
            reactFlowInstance.current.fitView({ padding: 0.2, duration: 400 })
          }
        }, 200)
      }

      if (msg.type === 'node_update') {
        const d = msg.data
        setNodes(nds => {
          const idx = nds.findIndex(n => n.id === d.id)
          if (idx >= 0) {
            const next = [...nds]
            next[idx] = { ...next[idx], data: { ...next[idx].data, ...d } }
            return next
          }
          const newNode = {
            id: d.id,
            type: 'map',
            data: { ...d },
            position: { x: Math.random() * 400, y: Math.random() * 300 },
          }
          return [...nds, newNode]
        })
      }

      if (msg.type === 'edge_update') {
        const d = msg.data
        setEdges(eds => {
          const idx = eds.findIndex(e => e.id === d.id)
          if (idx >= 0) {
            const next = [...eds]
            next[idx] = { ...next[idx], data: { ...next[idx].data, ...d } }
            return next
          }
          return [...eds, {
            id: d.id,
            source: d.source,
            target: d.target,
            type: 'metric',
            data: { ...d },
            animated: false,
          }]
        })
      }

      if (msg.type === 'discovery_complete') {
        setBusy(false)
        setBusyLabel('')
        const count = msg.nodes_added || msg.hops_added || 0
        showToast(`Discovery done: +${count} nodes from ${msg.source}`, 'success')
        setTimeout(() => {
          if (reactFlowInstance.current) {
            reactFlowInstance.current.fitView({ padding: 0.2, duration: 500 })
          }
        }, 250)
      }
    }

    return () => {
      ws.close()
    }
  }, [sessionId, layoutDir, setNodes, setEdges, showToast])

  // Re-layout when node count changes or layout direction switches
  const applyLayout = useCallback((dir = layoutDir) => {
    setNodes(nds => {
      setEdges(eds => {
        const layouted = getLayoutedElements(nds, eds, dir)
        setTimeout(() => {
          if (reactFlowInstance.current && layouted.nodes.length > 0) {
            reactFlowInstance.current.fitView({ padding: 0.2, duration: 400 })
          }
        }, 100)
        return layouted.edges
      })
      const layouted = getLayoutedElements(nds, edges, dir)
      return layouted.nodes
    })
  }, [layoutDir, edges, setNodes, setEdges])

  // ── Discover Subnet ──
  const discoverSubnet = useCallback(async () => {
    if (!sessionId || !selectedSubnet) return
    setBusy(true)
    setBusyLabel('Discovering subnet…')
    try {
      const r = await fetch(`/api/topology/${sessionId}/discover/subnet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subnet_id: selectedSubnet, include_gateway: true }),
      })
      if (!r.ok) {
        const t = await r.text()
        showToast(`Discover failed: ${t}`, 'error')
        setBusy(false)
        setBusyLabel('')
      }
    } catch {
      showToast('Discover request failed', 'error')
      setBusy(false)
      setBusyLabel('')
    }
  }, [sessionId, selectedSubnet, showToast])

  // ── Scan & Discover Subnet (Runs live fping scan then maps) ──
  const scanAndDiscoverSubnet = useCallback(async () => {
    if (!sessionId || !selectedSubnet) return
    setBusy(true)
    setBusyLabel('Scanning subnet with fping…')
    try {
      const scanRes = await fetch(`/api/ipam/subnets/${selectedSubnet}/scan`, { method: 'POST' })
      if (!scanRes.ok) {
        showToast('Subnet scan failed', 'error')
        setBusy(false)
        setBusyLabel('')
        return
      }
      setBusyLabel('Building network map…')
      await discoverSubnet()
    } catch {
      showToast('Scan & Map request failed', 'error')
      setBusy(false)
      setBusyLabel('')
    }
  }, [sessionId, selectedSubnet, discoverSubnet, showToast])

  // ── Discover Traceroute ──
  const discoverTrace = useCallback(async () => {
    if (!sessionId || !traceTarget.trim()) return
    setBusy(true)
    setBusyLabel(`Tracing route to ${traceTarget.trim()}…`)
    try {
      const r = await fetch(`/api/topology/${sessionId}/discover/trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: traceTarget.trim(),
          max_hops: 20,
          protocol: 'icmp',
          probes: 3,
        }),
      })
      if (!r.ok) {
        const t = await r.text()
        showToast(`Trace failed: ${t}`, 'error')
        setBusy(false)
        setBusyLabel('')
      }
    } catch {
      showToast('Trace request failed', 'error')
      setBusy(false)
      setBusyLabel('')
    }
  }, [sessionId, traceTarget, showToast])

  // ── Start / Stop Monitor ──
  const toggleMonitor = useCallback(async () => {
    if (!sessionId) return
    if (monitorId) {
      try {
        await fetch(`/api/topology/${sessionId}/monitor/stop`, { method: 'POST' })
      } catch {}
      setMonitorId(null)
      showToast('Ping monitor stopped', 'info')
    } else {
      setBusy(true)
      setBusyLabel('Starting live monitor…')
      try {
        const r = await fetch(`/api/topology/${sessionId}/monitor/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: [], interval_sec: monitorInterval, count: 3 }),
        })
        if (r.ok) {
          const d = await r.json()
          setMonitorId(d.monitor_id)
          showToast(`Monitor active (${d.targets.length} targets, every ${d.interval_sec}s)`, 'success')
        } else {
          showToast('No active target nodes available to monitor', 'error')
        }
      } catch {
        showToast('Monitor failed to start', 'error')
      }
      setBusy(false)
      setBusyLabel('')
    }
  }, [sessionId, monitorId, monitorInterval, showToast])

  // ── Enrich from Traffic Engine ──
  const enrichTraffic = useCallback(async () => {
    if (!sessionId) return
    try {
      const r = await fetch(`/api/topology/${sessionId}/enrich/traffic`, { method: 'POST' })
      if (r.ok) {
        const d = await r.json()
        showToast(`Enriched ${d.nodes_enriched} nodes with active traffic metrics`, 'success')
      }
    } catch {
      showToast('Traffic enrichment failed', 'error')
    }
  }, [sessionId, showToast])

  // ── Export Topology to JSON ──
  const exportTopologyJson = () => {
    const data = {
      sessionId,
      exportedAt: new Date().toISOString(),
      nodes: nodes.map(n => n.data),
      edges: edges.map(e => e.data),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `topology_${sessionId || 'export'}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Topology exported to JSON', 'success')
  }

  // ── Node Click ──
  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node.data)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // Stats calculation
  const stats = useMemo(() => {
    let up = 0
    let down = 0
    let rttSum = 0
    let rttCount = 0

    nodes.forEach(n => {
      if (n.data?.status === 'up') up++
      else if (n.data?.status === 'down' || n.data?.status === 'timeout') down++
      if (n.data?.latency_ms != null) {
        rttSum += n.data.latency_ms
        rttCount++
      }
    })

    return {
      nodes: nodes.length,
      edges: edges.length,
      up,
      down,
      avgRtt: rttCount > 0 ? (rttSum / rttCount).toFixed(1) : null,
    }
  }, [nodes, edges])

  return (
    <div className="page-wrap page-wrap-map">
      {/* ── Top Header ── */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontSize: 22,
            background: 'rgba(0, 212, 255, 0.12)',
            color: 'var(--cyan)',
            width: 42,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            border: '1px solid rgba(0, 212, 255, 0.25)',
          }}>
            🗺️
          </div>
          <div>
            <div className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Network Map & Topology Visualizer
              <span className={`ws-pill ws-${wsStatus}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                <span className="ws-dot" /> {wsStatus}
              </span>
              {monitorId && (
                <span className="monitor-pill" style={{ fontSize: 11, padding: '2px 8px' }}>
                  <span className="monitor-pulse" /> Ping Monitor ({monitorInterval}s)
                </span>
              )}
            </div>
            <div className="page-sub">
              Interactive LAN & WAN Topology Graph • Live Latency, Packet Loss & Traffic Flow
            </div>
          </div>
        </div>

        <div className="page-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Session: <code style={{ color: 'var(--cyan)' }}>{sessionId || 'initializing…'}</code>
          </span>
          <button className="btn-ghost btn-sm" onClick={exportTopologyJson} title="Export topology to JSON">
            💾 Export
          </button>
          <button className="btn-ghost btn-sm" onClick={deleteSession} title="Clear and reset topology">
            🗑️ Clear
          </button>
        </div>
      </div>

      {/* ── Control Toolbar ── */}
      <div className="map-toolbar">
        {/* Subnet Discovery Group */}
        <div className="toolbar-group">
          <div>
            <label className="toolbar-label">Subnet</label>
            <select
              className="toolbar-select"
              value={selectedSubnet}
              onChange={e => setSelectedSubnet(e.target.value)}
              disabled={busy || subnets.length === 0}
            >
              {subnets.length === 0 && <option value="">— No subnets saved —</option>}
              {subnets.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name || s.cidr} ({s.cidr})
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn-primary btn-sm"
            onClick={discoverSubnet}
            disabled={busy || !selectedSubnet}
            title="Visualize already known hosts from IPAM"
          >
            {busy && busyLabel.includes('subnet') ? 'Mapping…' : '🔍 Map Subnet'}
          </button>

          <button
            className="btn-ghost btn-sm"
            onClick={scanAndDiscoverSubnet}
            disabled={busy || !selectedSubnet}
            style={{ color: 'var(--green)', borderColor: 'rgba(0, 232, 135, 0.3)' }}
            title="Run fresh ICMP scan on this subnet then draw live devices"
          >
            ⚡ Scan & Map
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Trace Route Discovery Group */}
        <div className="toolbar-group">
          <div>
            <label className="toolbar-label">Trace Path</label>
            <input
              className="toolbar-input"
              style={{ width: 140 }}
              placeholder="8.8.8.8 or domain"
              value={traceTarget}
              onChange={e => setTraceTarget(e.target.value)}
              disabled={busy}
              onKeyDown={e => e.key === 'Enter' && discoverTrace()}
            />
          </div>
          <button
            className="btn-primary btn-sm"
            onClick={discoverTrace}
            disabled={busy || !traceTarget.trim()}
          >
            {busy && busyLabel.includes('Trac') ? 'Tracing…' : '📍 Trace Path'}
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Live Ping Monitor Group */}
        <div className="toolbar-group">
          <div>
            <label className="toolbar-label">Live Ping Monitor</label>
            <select
              className="toolbar-select toolbar-select-sm"
              value={monitorInterval}
              onChange={e => setMonitorInterval(Number(e.target.value))}
              disabled={busy || monitorId}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
          <button
            className={monitorId ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
            onClick={toggleMonitor}
            disabled={busy && !monitorId}
          >
            {monitorId ? '⏹ Stop' : '⏱ Start'}
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Utilities & Layout Group */}
        <div className="toolbar-group">
          <div>
            <label className="toolbar-label">Layout</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={`btn-ghost btn-xs ${layoutDir === 'LR' ? 'active' : ''}`}
                style={{ borderColor: layoutDir === 'LR' ? 'var(--cyan)' : 'var(--border)' }}
                onClick={() => {
                  setLayoutDir('LR')
                  applyLayout('LR')
                }}
                title="Left to Right Layout"
              >
                ↔ Horizontal
              </button>
              <button
                className={`btn-ghost btn-xs ${layoutDir === 'TB' ? 'active' : ''}`}
                style={{ borderColor: layoutDir === 'TB' ? 'var(--cyan)' : 'var(--border)' }}
                onClick={() => {
                  setLayoutDir('TB')
                  applyLayout('TB')
                }}
                title="Top to Bottom Layout"
              >
                ↕ Vertical
              </button>
            </div>
          </div>

          <button
            className="btn-ghost btn-sm"
            onClick={enrichTraffic}
            disabled={busy}
            title="Fetch bandwidth and packet metrics from traffic engine"
          >
            📊 Enrich Traffic
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => reactFlowInstance.current && reactFlowInstance.current.fitView({ padding: 0.2, duration: 400 })}
            title="Fit graph to canvas"
          >
            🎯 Fit View
          </button>
        </div>
      </div>

      {/* ── Main Canvas & Detail Overlay ── */}
      <div className="map-canvas-wrap">
        <div className="map-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={r => (reactFlowInstance.current = r)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            maxZoom={2.5}
          >
            <Background color="#162035" gap={20} size={1} />
            <Controls showInteractive={false} style={{ background: '#0e1526', border: '1px solid #1e293b' }} />
            <MiniMap
              nodeColor={n => {
                const t = n.data?.type
                if (t === 'gateway') return '#00d4ff'
                if (t === 'local') return '#a855f7'
                if (n.data?.status === 'down' || n.data?.status === 'timeout') return '#ff4466'
                return '#00e887'
              }}
              maskColor="rgba(8, 12, 24, 0.75)"
              style={{ background: '#0a0f1d', border: '1px solid #1e293b' }}
              pannable
              zoomable
            />
          </ReactFlow>

          {/* ── Empty State Prompt inside Canvas ── */}
          {nodes.length === 0 && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              background: 'rgba(10, 16, 32, 0.85)',
              padding: '28px 36px',
              borderRadius: 14,
              border: '1px dashed rgba(0, 212, 255, 0.3)',
              backdropFilter: 'blur(8px)',
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🗺️</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                Canvas Ready for Discovery
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
                Select a Subnet above and click <strong>🔍 Map Subnet</strong> or <strong>⚡ Scan & Map</strong>, or enter an IP to <strong>📍 Trace Path</strong>.
              </p>
            </div>
          )}

          {/* ── Node Detail Floating Card ── */}
          {selectedNode && (
            <div className="map-detail">
              <div className="map-detail-header">
                <div className="map-detail-title">
                  <span className="map-detail-icon">
                    {({ local: '💻', gateway: '🌐', host: '🖥️', router: '📡', unknown: '❓' })[selectedNode.type] || '●'}
                  </span>
                  <div>
                    <div className="map-detail-name">{selectedNode.label || selectedNode.ip}</div>
                    <div className="map-detail-sub">
                      {selectedNode.type} ·{' '}
                      <span style={{ color: selectedNode.status === 'up' ? '#00e887' : '#ff4466', fontWeight: 600 }}>
                        {selectedNode.status || 'unknown'}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => setSelectedNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div className="map-detail-body">
                {selectedNode.ip && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">IP Address</span>
                    <code className="map-detail-v" style={{ color: 'var(--cyan)' }}>{selectedNode.ip}</code>
                  </div>
                )}
                {selectedNode.dns && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">DNS PTR</span>
                    <span className="map-detail-v">{selectedNode.dns}</span>
                  </div>
                )}
                {selectedNode.system_name && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">System Alias</span>
                    <span className="map-detail-v">{selectedNode.system_name}</span>
                  </div>
                )}
                {selectedNode.vlan_id != null && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">VLAN</span>
                    <span className="map-detail-v">
                      VLAN {selectedNode.vlan_id} {selectedNode.vlan_name ? `(${selectedNode.vlan_name})` : ''}
                    </span>
                  </div>
                )}
                {selectedNode.latency_ms != null && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">Latency (RTT)</span>
                    <span className="map-detail-v" style={{ color: '#00d4ff', fontWeight: 600 }}>
                      {selectedNode.latency_ms.toFixed(1)} ms
                    </span>
                  </div>
                )}
                {selectedNode.loss_percent != null && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">Packet Loss</span>
                    <span className={`map-detail-v ${selectedNode.loss_percent > 0 ? 'val-bad' : ''}`}>
                      {selectedNode.loss_percent.toFixed(1)}%
                    </span>
                  </div>
                )}
                {selectedNode.traffic_mb != null && selectedNode.traffic_mb > 0 && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">Throughput</span>
                    <span className="map-detail-v" style={{ color: '#00e887' }}>
                      {selectedNode.traffic_mb.toFixed(2)} MB
                    </span>
                  </div>
                )}
                {selectedNode.machine_type && (
                  <div className="map-detail-row">
                    <span className="map-detail-k">Device Type</span>
                    <span className="map-detail-v">{selectedNode.machine_type}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons to cross-navigate to other modules */}
              <div style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border)',
                background: 'rgba(0,0,0,0.25)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>
                  Quick Launch from Node
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {onNavigate && selectedNode.ip && (
                    <>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onNavigate('client', selectedNode.ip)}
                        style={{ cursor: 'pointer' }}
                        title="Test throughput with iPerf3"
                      >
                        ⚡ iPerf3
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onNavigate('trace', selectedNode.ip)}
                        style={{ cursor: 'pointer' }}
                        title="Trace route to this node"
                      >
                        📍 Trace
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onNavigate('nmap', selectedNode.ip)}
                        style={{ cursor: 'pointer' }}
                        title="Scan ports and vulnerabilities"
                      >
                        🔍 Nmap
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onNavigate('ssl', selectedNode.ip)}
                        style={{ cursor: 'pointer' }}
                        title="Analyze SSL/TLS certificate"
                      >
                        🔐 SSL
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        onClick={() => onNavigate('dns', selectedNode.ip)}
                        style={{ cursor: 'pointer', gridColumn: 'span 2' }}
                        title="Lookup DNS PTR & WHOIS"
                      >
                        🔎 DNS & WHOIS
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Status Bar / Stats & Legend ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg-card)',
          padding: '6px 14px',
          borderRadius: 'var(--radius-xs)',
          border: '1px solid var(--border)',
          fontSize: 11,
          flexWrap: 'wrap',
          gap: 12,
        }}>
          {/* Legend */}
          <div className="map-legend" style={{ margin: 0, padding: 0, border: 'none', background: 'transparent' }}>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#00e887' }} /> Up</div>
            <div className="legend-item"><span className="legend-dot" style={{ background: '#ff4466' }} /> Down / Timeout</div>
            <div className="legend-item"><span className="legend-sq" style={{ background: '#00d4ff' }} /> Gateway</div>
            <div className="legend-item"><span className="legend-sq" style={{ background: '#a855f7' }} /> Local Host</div>
            <div className="legend-item"><span className="legend-line" style={{ borderTopColor: '#00e887' }} /> &lt; 20ms</div>
            <div className="legend-item"><span className="legend-line" style={{ borderTopColor: '#00d4ff' }} /> 20-80ms</div>
            <div className="legend-item"><span className="legend-line" style={{ borderTopColor: '#ffbb00' }} /> 80-150ms</div>
            <div className="legend-item"><span className="legend-line legend-line-dashed" style={{ borderTopColor: '#ff4466' }} /> Timeout</div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', gap: 14, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
            <span>Nodes: <strong style={{ color: 'var(--text-primary)' }}>{stats.nodes}</strong></span>
            <span>Edges: <strong style={{ color: 'var(--text-primary)' }}>{stats.edges}</strong></span>
            <span>Online: <strong style={{ color: '#00e887' }}>{stats.up}</strong></span>
            {stats.down > 0 && <span>Down: <strong style={{ color: '#ff4466' }}>{stats.down}</strong></span>}
            {stats.avgRtt && <span>Avg RTT: <strong style={{ color: '#00d4ff' }}>{stats.avgRtt} ms</strong></span>}
          </div>
        </div>
      </div>

      {/* ── Toast Notification ── */}
      {toast && (
        <div className={`map-toast map-toast-${toast.kind}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
