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
  const [probes, setProbes] = useState(3)
  const [protocol, setProtocol] = useState('icmp') // icmp | udp | tcp
  const [status, setStatus] = useState('idle') // idle | running | complete | error
  const [hops, setHops] = useState([])
  const [logs, setLogs] = useState([])
  const [command, setCommand] = useState('')

  // ── Loop Mode State ──
  const [loopEnabled, setLoopEnabled] = useState(true)
  const [loopCount, setLoopCount] = useState(0) // 0 = Infinite / Continuous until stopped
  const [loopInterval, setLoopInterval] = useState(2) // seconds delay between cycles
  const [currentCycle, setCurrentCycle] = useState(1)
  const [countdown, setCountdown] = useState(0)
  const [isWaitingNextCycle, setIsWaitingNextCycle] = useState(false)
  const [cycleStats, setCycleStats] = useState({}) // { [hop]: { count, successCount, min, max, sum, avg } }

  const wsRef = useRef(null)
  const isStoppingRef = useRef(false)
  const timerRef = useRef(null)
  const activeTraceIdRef = useRef(null)

  useEffect(() => {
    if (initialHost && !host) {
      setHost(initialHost)
    }
  }, [initialHost])

  useEffect(() => {
    return () => {
      isStoppingRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const addLog = (text, type = '') => {
    setLogs(prev => [
      ...prev.slice(-300),
      { id: Date.now() + Math.random(), text, type, time: new Date().toLocaleTimeString() }
    ])
  }

  const updateCumulativeStats = (latestHops) => {
    setCycleStats(prev => {
      const next = { ...prev }
      latestHops.forEach(h => {
        const existing = next[h.hop] || {
          count: 0,
          successCount: 0,
          min: null,
          max: null,
          sum: 0,
          avg: null,
          ip: h.ip,
        }
        existing.count += 1
        existing.ip = h.ip !== '*' ? h.ip : existing.ip

        if (h.avg_rtt !== null && h.status === 'success') {
          existing.successCount += 1
          existing.min = existing.min === null ? h.avg_rtt : Math.min(existing.min, h.avg_rtt)
          existing.max = existing.max === null ? h.avg_rtt : Math.max(existing.max, h.avg_rtt)
          existing.sum += h.avg_rtt
          existing.avg = Number((existing.sum / existing.successCount).toFixed(2))
        }
        next[h.hop] = existing
      })
      return next
    })
  }

  const runOneTraceCycle = (cycleNum) => {
    return new Promise((resolve, reject) => {
      fetch('/api/trace/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), max_hops: Number(maxHops), probes: Number(probes), protocol }),
      })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || 'Failed to start trace')
        }
        return res.json()
      })
      .then(data => {
        activeTraceIdRef.current = data.trace_id
        setCommand(data.command || `traceroute -n -m ${maxHops} ${host}`)
        addLog(`[Cycle ${cycleNum}] Starting route trace to ${host.trim()}...`, 'info')

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${proto}://${window.location.host}/ws/trace/${data.trace_id}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        let currentCycleHops = []

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
                  currentCycleHops = next
                  return next
                }
                const next = [...prev, msg.data].sort((a, b) => a.hop - b.hop)
                currentCycleHops = next
                return next
              })
            } else if (msg.type === 'complete') {
              addLog(`[Cycle ${cycleNum}] Route trace completed.`, 'info')
              ws.close()
              resolve(currentCycleHops)
            } else if (msg.type === 'error') {
              addLog(`[Cycle ${cycleNum}] Error: ${msg.message}`, 'error')
              ws.close()
              reject(new Error(msg.message))
            }
          } catch (e) {
            console.error(e)
          }
        }

        ws.onclose = () => {
          if (isStoppingRef.current) {
            resolve(currentCycleHops)
          }
        }

        ws.onerror = () => {
          if (isStoppingRef.current) {
            resolve(currentCycleHops)
            return
          }
          addLog(`[Cycle ${cycleNum}] WebSocket error`, 'error')
          reject(new Error('WebSocket connection error'))
        }
      })
      .catch(err => {
        if (isStoppingRef.current) {
          resolve([])
          return
        }
        addLog(`[Cycle ${cycleNum}] ${err.message}`, 'error')
        reject(err)
      })
    })
  }

  const startTrace = async () => {
    if (!host.trim()) {
      addLog('Target host or IP address is required', 'error')
      return
    }

    isStoppingRef.current = false
    setStatus('running')
    setHops([])
    setLogs([])
    setCommand('')
    setCycleStats({})
    setCurrentCycle(1)

    let cycle = 1
    const isContinuous = loopEnabled && (loopCount === 0)

    while (!isStoppingRef.current) {
      if (!isContinuous && !loopEnabled && cycle > 1) break
      if (!isContinuous && loopEnabled && loopCount > 0 && cycle > loopCount) break

      setCurrentCycle(cycle)
      setIsWaitingNextCycle(false)

      try {
        const cycleHops = await runOneTraceCycle(cycle)
        if (isStoppingRef.current) break

        if (cycleHops && cycleHops.length > 0) {
          updateCumulativeStats(cycleHops)
        }

        // If loop continues (continuous or cycles remain), pause for interval
        const willContinue = !isStoppingRef.current && (isContinuous || (loopEnabled && cycle < loopCount))
        if (willContinue) {
          setIsWaitingNextCycle(true)
          addLog(`[Cycle ${cycle}] Finished. Waiting ${loopInterval}s before cycle ${cycle + 1}... (Click "Stop" to end)`, 'info')

          for (let sec = loopInterval; sec > 0; sec--) {
            if (isStoppingRef.current) break
            setCountdown(sec)
            await new Promise(r => { timerRef.current = setTimeout(r, 1000) })
          }
          setCountdown(0)
          if (isStoppingRef.current) break
        }
      } catch (err) {
        if (isStoppingRef.current) break
        addLog(`Trace stopped on cycle ${cycle}: ${err.message}`, 'error')
        break
      }

      cycle++
    }

    setIsWaitingNextCycle(false)
    setStatus('idle')
    activeTraceIdRef.current = null
  }

  const stopTrace = () => {
    isStoppingRef.current = true
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (activeTraceIdRef.current) {
      fetch(`/api/trace/stop/${activeTraceIdRef.current}`, { method: 'POST' }).catch(() => {})
      activeTraceIdRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsWaitingNextCycle(false)
    setStatus('idle')
    addLog('Route trace stopped by user.', 'info')
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
              <div className="form-group">
                <label className="form-label">Repeat / Probes</label>
                <input
                  type="number"
                  className="form-input"
                  value={probes}
                  onChange={e => setProbes(Math.max(1, Math.min(10, Number(e.target.value))))}
                  disabled={status === 'running'}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Trace Protocol</label>
              <div className="tab-group" style={{ display: 'flex', gap: 6 }}>
                {[
                  { id: 'icmp', label: 'ICMP (Ping)' },
                  { id: 'udp',  label: 'UDP' },
                  { id: 'tcp',  label: 'TCP (SYN)' },
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn ${protocol === p.id ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1, padding: '6px 0', fontSize: 11 }}
                    onClick={() => setProtocol(p.id)}
                    disabled={status === 'running'}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Trace Mode Selection ── */}
            <div className="form-group" style={{ marginTop: 4 }}>
              <label className="form-label">Trace Mode</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className={`btn ${loopEnabled ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1.2, padding: '7px 8px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => setLoopEnabled(true)}
                  disabled={status === 'running'}
                >
                  <span>🔁 Continuous Loop</span>
                </button>
                <button
                  type="button"
                  className={`btn ${!loopEnabled ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 0.8, padding: '7px 8px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => setLoopEnabled(false)}
                  disabled={status === 'running'}
                >
                  <span>📍 Single Run</span>
                </button>
              </div>

              {loopEnabled && (
                <div style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.25)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(16,185,129,0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>♾️</span> Loops until stopped manually
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      Press [Stop] to finish
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
                      Interval between loops:
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number"
                        className="form-input"
                        style={{ width: 56, padding: '3px 6px', fontSize: 11, textAlign: 'center' }}
                        value={loopInterval}
                        min={1}
                        max={60}
                        onChange={e => setLoopInterval(Math.max(1, Math.min(60, Number(e.target.value))))}
                        disabled={status === 'running'}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>sec</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="btn-group" style={{ marginTop: 8 }}>
              {status !== 'running' ? (
                <button className="btn btn-primary btn-full" onClick={startTrace}>
                  {loopEnabled ? '🔁 Start Continuous Loop Trace' : '📍 Start Route Trace'}
                </button>
              ) : (
                <button
                  className="btn btn-danger btn-full"
                  onClick={stopTrace}
                  style={{ background: '#ef4444', borderColor: '#dc2626' }}
                >
                  ■ Stop Route Trace {loopEnabled && `(Cycle ${currentCycle})`}
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
              {loopEnabled && (
                <div className="summary-card" style={{ borderColor: isWaitingNextCycle ? 'var(--yellow)' : 'var(--border)' }}>
                  <div className="summary-label">
                    {isWaitingNextCycle ? '⏳ Next Cycle' : '🔁 Loop Status'}
                  </div>
                  <div className="summary-value cyan" style={{ fontSize: isWaitingNextCycle ? '15px' : '18px' }}>
                    {isWaitingNextCycle ? `In ${countdown}s...` : `Cycle ${currentCycle} (∞)`}
                  </div>
                </div>
              )}
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
                {status === 'running' && (
                  <span className="live-badge">
                    {isWaitingNextCycle ? `⏳ WAITING ${countdown}s` : `● TRACING (CYCLE ${currentCycle})...`}
                  </span>
                )}
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
                        const stat = cycleStats[data.hop]
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
                              Current Latency: <strong>{data.avg_rtt !== null ? `${data.avg_rtt} ms` : 'Request timed out'}</strong>
                            </div>
                            {stat && stat.count > 1 && (
                              <div style={{ fontSize: 11, color: '#10b981', marginTop: 3 }}>
                                Multi-cycle: Min {stat.min}ms | Avg {stat.avg}ms | Max {stat.max}ms
                              </div>
                            )}
                            {data.rtts && data.rtts.length > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                Probes: {data.rtts.join('ms | ')}ms
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
              <h2 className="card-title">
                🌐 Route Hops Details {loopEnabled && currentCycle > 1 && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>(Cumulative across {currentCycle} cycles)</span>}
              </h2>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px' }}>Hop #</th>
                      <th style={{ padding: '8px 12px' }}>IP Address</th>
                      <th style={{ padding: '8px 12px' }}>Current RTT</th>
                      {loopEnabled && <th style={{ padding: '8px 12px' }}>Min / Avg / Max</th>}
                      <th style={{ padding: '8px 12px' }}>Latest Probes</th>
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

                      const stat = cycleStats[h.hop]

                      const probeText = h.rtts && h.rtts.length > 0
                        ? h.rtts.map(r => `${r} ms`).join(' | ')
                        : [h.rtt1, h.rtt2, h.rtt3].filter(r => r !== null).map(r => `${r} ms`).join(' | ') || '*'

                      return (
                        <tr key={h.hop} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{h.hop}</td>
                          <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: isTimeout ? 'var(--text-muted)' : '#10b981' }}>
                            {h.ip}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: rttColor }}>
                            {h.avg_rtt !== null ? `${h.avg_rtt} ms` : 'Timed out'}
                          </td>
                          {loopEnabled && (
                            <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-primary)' }}>
                              {stat && stat.avg !== null
                                ? `${stat.min} / ${stat.avg} / ${stat.max} ms`
                                : '-'}
                            </td>
                          )}
                          <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--text-secondary)' }}>
                            {probeText}
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
