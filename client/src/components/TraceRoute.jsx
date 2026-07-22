import { useState, useRef, useEffect } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

// Custom node badge component matching user reference image (Green IP label box over points)
const CustomHopBadge = (props) => {
  const { cx, cy, payload } = props
  if (!cx || !cy || !payload) return null

  const isTimeout = payload.status === 'timeout' || payload.ip === '*'
  const labelText = payload.ip || `Hop ${payload.hop}`

  return (
    <g transform={`translate(${cx},${cy})`}>
      {/* Node circle */}
      <circle
        r={5}
        fill={isTimeout ? 'var(--red)' : '#10b981'}
        stroke="#0f172a"
        strokeWidth={2}
      />
      {/* Green IP Badge box matching user image */}
      <g transform="translate(0, -22)">
        <rect
          x={-(labelText.length * 4.2 + 8)}
          y={-10}
          width={labelText.length * 8.4 + 16}
          height={20}
          rx={4}
          ry={4}
          fill={isTimeout ? 'rgba(239, 68, 68, 0.85)' : 'rgba(16, 185, 129, 0.9)'}
          stroke={isTimeout ? '#ef4444' : '#059669'}
          strokeWidth={1}
        />
        <text
          x={0}
          y={3}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={11}
          fontWeight={600}
          fontFamily="'JetBrains Mono', monospace"
        >
          {labelText}
        </text>
      </g>
    </g>
  )
}

export default function TraceRoute({ initialHost = '' }) {
  const [host, setHost] = useState(initialHost || '')
  const [maxHops, setMaxHops] = useState(30)
  const [status, setStatus] = useState('idle') // idle | running | complete | error
  const [hops, setHops] = useState([])
  const [logs, setLogs] = useState([])
  const [command, setCommand] = useState('')
  const wsRef = useRef(null)

  useEffect(() => {
    if (initialHost && !host) {
      setHost(initialHost)
    }
  }, [initialHost])

  const addLog = (text, type = '') => {
    setLogs(prev => [
      ...prev.slice(-300),
      { id: Date.now() + Math.random(), text, type, time: new Date().toLocaleTimeString() }
    ])
  }

  const startTrace = async () => {
    if (!host.trim()) {
      addLog('Target host or IP address is required', 'error')
      return
    }

    setStatus('running')
    setHops([])
    setLogs([])
    setCommand('')

    try {
      const res = await fetch('/api/trace/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), max_hops: Number(maxHops) }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to start trace')
      }

      const data = await res.json()
      setCommand(data.command || `traceroute -n -m ${maxHops} ${host}`)
      addLog(`Started route trace to ${host.trim()}...`, 'info')

      // Connect WebSocket
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${proto}://${window.location.host}/ws/trace/${data.trace_id}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'log') {
            addLog(msg.message)
          } else if (msg.type === 'hop') {
            setHops(prev => {
              const existingIndex = prev.findIndex(h => h.hop === msg.data.hop)
              if (existingIndex >= 0) {
                const next = [...prev]
                next[existingIndex] = msg.data
                return next
              }
              return [...prev, msg.data].sort((a, b) => a.hop - b.hop)
            })
          } else if (msg.type === 'complete') {
            setStatus('complete')
            addLog('Route trace completed.', 'info')
            ws.close()
          } else if (msg.type === 'error') {
            setStatus('error')
            addLog(`Error: ${msg.message}`, 'error')
            ws.close()
          }
        } catch (e) {
          console.error(e)
        }
      }

      ws.onerror = () => {
        setStatus('error')
        addLog('WebSocket connection error', 'error')
      }

      ws.onclose = () => {
        if (status === 'running') {
          setStatus('complete')
        }
      }

    } catch (err) {
      setStatus('error')
      addLog(err.message, 'error')
    }
  }

  const stopTrace = () => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    setStatus('idle')
  }

  // Calculate stats
  const successfulHops = hops.filter(h => h.status === 'success' && h.avg_rtt !== null)
  const maxRtt = successfulHops.length > 0 ? Math.max(...successfulHops.map(h => h.avg_rtt)) : 0
  const minRtt = successfulHops.length > 0 ? Math.min(...successfulHops.map(h => h.avg_rtt)) : 0

  return (
    <div className="trace-container">
      <div className="page-header">
        <h1 className="page-title">📍 Network Route Trace</h1>
        <p className="page-desc">Discover hops, IP addresses, and latency (RTT) along the network path to your target host.</p>
      </div>

      <div className="client-layout">
        {/* ── Left Column: Config Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
          <div className="card config-card">
            <h2 className="card-title">⚙️ Trace Target</h2>

            <div className="form-group">
              <label className="form-label">Target Host / IP <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span></label>
              <input
                type="text"
                className="form-input"
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="e.g. 8.8.8.8 or www.apple.com"
                disabled={status === 'running'}
                autoComplete="off"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Max Hops (TTL)</label>
              <input
                type="number"
                className="form-input"
                value={maxHops}
                onChange={e => setMaxHops(Math.max(1, Math.min(64, Number(e.target.value))))}
                disabled={status === 'running'}
              />
            </div>

            <div className="btn-group">
              {status !== 'running' ? (
                <button className="btn btn-primary btn-full" onClick={startTrace}>
                  📍 Start Route Trace
                </button>
              ) : (
                <button className="btn btn-danger btn-full" onClick={stopTrace}>
                  ■ Stop Trace
                </button>
              )}
            </div>

            {command && (
              <div style={{ marginTop: 16 }}>
                <div className="form-label">Command</div>
                <div style={{
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: 'var(--cyan)',
                  wordBreak: 'break-all',
                  lineHeight: 1.6,
                }}>
                  {command}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column: Visual Results ── */}
        <div className="results-panel">
          {/* Summary Cards */}
          {hops.length > 0 && (
            <div className="summary-cards">
              <div className="summary-card">
                <div className="summary-label">Total Hops</div>
                <div className="summary-value cyan">{hops.length}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Min Latency</div>
                <div className="summary-value green">{minRtt} <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7 }}>ms</span></div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Target Latency</div>
                <div className="summary-value yellow">
                  {successfulHops.length > 0 ? successfulHops[successfulHops.length - 1].avg_rtt : 'N/A'}{' '}
                  <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7 }}>ms</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Interactive Hop Latency Graph (Visual Traceroute with Green Badges) ── */}
          {hops.length > 0 && (
            <div className="card">
              <h2 className="card-title">
                📈 Hop Latency (RTT ms) &amp; IP Map
                {status === 'running' && <span className="live-badge">● TRACING...</span>}
              </h2>
              <div style={{ width: '100%', height: 320, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hops} margin={{ top: 35, right: 30, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="hop"
                      stroke="var(--text-muted)"
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      label={{ value: 'Hop Number', position: 'insideBottom', offset: -15, fill: 'var(--text-muted)', fontSize: 12 }}
                    />
                    <YAxis
                      stroke="var(--text-muted)"
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      label={{ value: 'RTT (ms)', angle: -90, position: 'insideLeft', offset: 10, fill: 'var(--text-muted)', fontSize: 12 }}
                      domain={[0, 'dataMax + 10']}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null
                        const data = payload[0].payload
                        return (
                          <div style={{
                            background: '#0f172a',
                            border: '1px solid var(--cyan)',
                            borderRadius: '8px',
                            padding: '10px 14px',
                            boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
                          }}>
                            <div style={{ fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}>
                              Hop {data.hop}: {data.ip}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                              Avg Latency: <strong>{data.avg_rtt !== null ? `${data.avg_rtt} ms` : 'Request timed out'}</strong>
                            </div>
                            {data.rtt1 !== null && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                Probes: {data.rtt1}ms | {data.rtt2}ms | {data.rtt3}ms
                              </div>
                            )}
                          </div>
                        )
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_rtt"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      dot={<CustomHopBadge />}
                      activeDot={{ r: 7, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Hop Details Table ── */}
          {hops.length > 0 && (
            <div className="card">
              <h2 className="card-title">🌐 Route Hops Details</h2>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px' }}>Hop #</th>
                      <th style={{ padding: '8px 12px' }}>IP Address</th>
                      <th style={{ padding: '8px 12px' }}>RTT 1</th>
                      <th style={{ padding: '8px 12px' }}>RTT 2</th>
                      <th style={{ padding: '8px 12px' }}>RTT 3</th>
                      <th style={{ padding: '8px 12px' }}>Avg Latency</th>
                      <th style={{ padding: '8px 12px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hops.map(h => {
                      const isTimeout = h.status === 'timeout' || h.ip === '*'
                      const rttColor = isTimeout
                        ? 'var(--red)'
                        : h.avg_rtt < 20
                        ? '#10b981'
                        : h.avg_rtt < 60
                        ? 'var(--cyan)'
                        : 'var(--yellow)'

                      return (
                        <tr key={h.hop} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{h.hop}</td>
                          <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: isTimeout ? 'var(--text-muted)' : '#10b981' }}>
                            {h.ip}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{h.rtt1 !== null ? `${h.rtt1} ms` : '*'}</td>
                          <td style={{ padding: '8px 12px' }}>{h.rtt2 !== null ? `${h.rtt2} ms` : '*'}</td>
                          <td style={{ padding: '8px 12px' }}>{h.rtt3 !== null ? `${h.rtt3} ms` : '*'}</td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: rttColor }}>
                            {h.avg_rtt !== null ? `${h.avg_rtt} ms` : 'Timed out'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 600,
                              background: isTimeout ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)',
                              color: isTimeout ? '#ef4444' : '#10b981',
                              border: `1px solid ${isTimeout ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
                            }}>
                              {isTimeout ? 'TIMEOUT' : 'OK'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Console Output ── */}
          {logs.length > 0 && (
            <div className="card">
              <h2 className="card-title">🖥️ Output Log</h2>
              <div className="log-console compact">
                {logs.map(log => (
                  <div key={log.id} className={`log-line ${log.type}`}>
                    <span className="log-time">{log.time}</span>
                    <span className="log-text">{log.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Idle Empty State ── */}
          {hops.length === 0 && status === 'idle' && (
            <div className="card empty-state">
              <div className="empty-icon">📍</div>
              <div className="empty-title">Ready to trace network path</div>
              <div className="empty-subtitle">
                Enter target IP address or hostname and click <strong>Start Route Trace</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
