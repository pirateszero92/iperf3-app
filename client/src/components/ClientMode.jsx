import { useState, useRef, useEffect } from 'react'
import LiveChart from './LiveChart'

const DEFAULT = {
  host: '', port: 5201, protocol: 'tcp',
  duration: 10, parallel: 1,
  reverse: false, bidir: false,
  bandwidth: '', buffer_length: '',
}

export default function ClientMode({ onComplete, onRunTrace }) {
  const [cfg, setCfg]       = useState(DEFAULT)
  const [status, setStatus] = useState('idle')  // idle | running | complete | error
  const [liveData, setLiveData]   = useState([])
  const [logs, setLogs]           = useState([])
  const [summary, setSummary]     = useState(null)
  const [command, setCommand]     = useState('')
  const wsRef = useRef(null)

  const [savedTargets, setSavedTargets] = useState(() => {
    try {
      const saved = localStorage.getItem('iperf3_saved_targets')
      return saved ? JSON.parse(saved) : []
    } catch (e) {
      return []
    }
  })

  const saveTarget = () => {
    if (!cfg.host.trim()) {
      alert('Please fill in a target host first!')
      return
    }
    const label = window.prompt("Enter a label/name for this configuration:", cfg.host)
    if (label === null) return

    const newTarget = {
      id: Date.now().toString(),
      label: label.trim() || cfg.host,
      config: { ...cfg }
    }

    const updated = [...savedTargets, newTarget]
    setSavedTargets(updated)
    localStorage.setItem('iperf3_saved_targets', JSON.stringify(updated))
  }

  const editTarget = (id) => {
    const target = savedTargets.find(t => t.id === id)
    if (!target) return
    const newLabel = window.prompt("Edit label/name:", target.label)
    if (newLabel === null) return

    const updated = savedTargets.map(t => t.id === id ? { ...t, label: newLabel.trim() || t.label } : t)
    setSavedTargets(updated)
    localStorage.setItem('iperf3_saved_targets', JSON.stringify(updated))
  }

  const deleteTarget = (id) => {
    if (!window.confirm("Delete this saved target?")) return
    const updated = savedTargets.filter(t => t.id !== id)
    setSavedTargets(updated)
    localStorage.setItem('iperf3_saved_targets', JSON.stringify(updated))
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const addLog = (text, type = '') =>
    setLogs(prev => [
      ...prev.slice(-300),
      { id: Date.now() + Math.random(), text, type, time: new Date().toLocaleTimeString() },
    ])

  const set = (key, val) =>
    setCfg(c => {
      const next = { ...c, [key]: val }
      if (key === 'reverse' && val) next.bidir = false
      if (key === 'bidir'   && val) next.reverse = false
      return next
    })

  // ── Run test ──────────────────────────────────────────────────────────────
  const runTest = async () => {
    if (!cfg.host.trim()) { addLog('Target host is required', 'error'); return }

    setStatus('running')
    setLiveData([])
    setLogs([])
    setSummary(null)
    setCommand('')

    try {
      const res  = await fetch('/api/client/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to start test')

      setCommand(data.command)
      addLog(`▶ ${data.command}`, 'info')

      // WebSocket for live updates
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/client/${data.test_id}`)
      wsRef.current = ws

      ws.onmessage = e => {
        const msg = JSON.parse(e.data)

        if (msg.type === 'log') {
          addLog(msg.message)

        } else if (msg.type === 'interval') {
          // For parallel streams, sum bandwidths in the same time window
          setLiveData(prev => {
            const key = msg.data.interval_end
            const idx = prev.findIndex(d => d.interval_end === key)
            if (idx >= 0) {
              const updated = [...prev]
              updated[idx] = {
                ...updated[idx],
                bandwidth_mbps: parseFloat(
                  (updated[idx].bandwidth_mbps + msg.data.bandwidth_mbps).toFixed(2)
                ),
              }
              return updated
            }
            return [...prev, msg.data]
          })

        } else if (msg.type === 'complete') {
          setStatus('complete')
          setSummary(msg.summary)
          addLog('✓ Test completed successfully', 'success')
          onComplete?.()
          ws.close()

        } else if (msg.type === 'error') {
          setStatus('error')
          addLog(`✗ ${msg.message}`, 'error')
          ws.close()
        }
      }

      ws.onerror = () => {
        setStatus('error')
        addLog('WebSocket connection error', 'error')
      }

    } catch (err) {
      setStatus('error')
      addLog(`✗ ${err.message}`, 'error')
    }
  }

  const reset = () => {
    wsRef.current?.close()
    setStatus('idle')
    setLiveData([])
    setLogs([])
    setSummary(null)
    setCommand('')
  }

  const isRunning = status === 'running'

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Client Mode</h1>
          <p className="page-subtitle">Measure network performance against an iPerf3 server</p>
        </div>
        {status !== 'idle' && (
          <div className={`status-badge ${status}`}>
            <span className="status-dot" />
            {status === 'running' ? 'Running…' : status === 'complete' ? 'Complete' : 'Error'}
          </div>
        )}
      </div>

      <div className="client-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
          {/* ── Config card ── */}
          <div className="card config-card">
            <h2 className="card-title">⚙️ Configuration</h2>

          {/* Target host */}
          <div className="form-group">
            <label className="form-label">Target Host / IP <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span></label>
            <input
              type="text"
              className="form-input"
              value={cfg.host}
              onChange={e => set('host', e.target.value)}
              placeholder="192.168.1.1"
              disabled={isRunning}
              autoComplete="off"
            />
          </div>

          {/* Port + Duration */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                type="number"
                className="form-input"
                value={cfg.port}
                onChange={e => set('port', Number(e.target.value))}
                disabled={isRunning}
                min={1024}
                max={65535}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Duration (s)</label>
              <input
                type="number"
                className="form-input"
                value={cfg.duration}
                onChange={e => set('duration', Number(e.target.value))}
                disabled={isRunning}
                min={1}
                max={3600}
              />
            </div>
          </div>

          {/* Protocol */}
          <div className="form-group">
            <label className="form-label">Protocol</label>
            <div className="protocol-toggle">
              <button
                className={`protocol-btn ${cfg.protocol === 'tcp' ? 'active' : ''}`}
                onClick={() => set('protocol', 'tcp')}
                disabled={isRunning}
              >TCP</button>
              <button
                className={`protocol-btn ${cfg.protocol === 'udp' ? 'active' : ''}`}
                onClick={() => set('protocol', 'udp')}
                disabled={isRunning}
              >UDP</button>
            </div>
          </div>

          {/* UDP bandwidth */}
          {cfg.protocol === 'udp' && (
            <div className="form-group">
              <label className="form-label">UDP Bandwidth (e.g. 100M, 1G)</label>
              <input
                type="text"
                className="form-input"
                value={cfg.bandwidth}
                onChange={e => set('bandwidth', e.target.value)}
                placeholder="100M"
                disabled={isRunning}
              />
            </div>
          )}

          {/* Parallel + Buffer */}
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">Parallel Streams</label>
              <input
                type="number"
                className="form-input"
                value={cfg.parallel}
                onChange={e => set('parallel', Number(e.target.value))}
                disabled={isRunning}
                min={1}
                max={128}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Buffer Length</label>
              <input
                type="text"
                className="form-input"
                value={cfg.buffer_length}
                onChange={e => set('buffer_length', e.target.value)}
                placeholder="128K"
                disabled={isRunning}
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="toggle-group">
            <label className="toggle">
              <input
                type="checkbox"
                checked={cfg.reverse}
                onChange={e => set('reverse', e.target.checked)}
                disabled={isRunning || cfg.bidir}
              />
              <span className="toggle-track" />
              <span className="toggle-label">Reverse mode (download from server)</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={cfg.bidir}
                onChange={e => set('bidir', e.target.checked)}
                disabled={isRunning || cfg.reverse}
              />
              <span className="toggle-track" />
              <span className="toggle-label">Bidirectional test</span>
            </label>
          </div>

          {/* Actions */}
          <div className="btn-group">
            {!isRunning ? (
              <>
                <button className="btn btn-primary btn-full" onClick={runTest}>
                  ▶ Run Test
                </button>
                {onRunTrace && (
                  <button
                    className="btn btn-ghost btn-full"
                    onClick={() => onRunTrace(cfg.host)}
                    disabled={!cfg.host.trim()}
                  >
                    📍 Trace Route
                  </button>
                )}
                {status !== 'idle' && (
                  <button className="btn btn-ghost btn-full" onClick={reset}>
                    ↩ Reset
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-danger btn-full" onClick={reset}>
                ■ Stop
              </button>
            )}
          </div>

          {/* Command preview */}
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

        {/* ── Saved Targets card ── */}
        <div className="card">
          <h2 className="card-title">📌 Saved Configurations</h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto', marginBottom: '16px' }}>
            {savedTargets.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '16px 0', lineHeight: 1.6 }}>
                No saved configurations.<br />Setup your config and click save below.
              </div>
            ) : (
              savedTargets.map(t => (
                <div 
                  key={t.id} 
                  onClick={() => setCfg(t.config)}
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.borderColor = 'var(--cyan)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', width: '70%' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.label}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.config.host}:{t.config.port} • {t.config.protocol.toUpperCase()} {t.config.parallel > 1 ? `(x${t.config.parallel})` : ''}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                      className="btn-icon" 
                      title="Edit name"
                      onClick={e => { e.stopPropagation(); editTarget(t.id); }}
                    >
                      ✏️
                    </button>
                    <button 
                      className="btn-icon danger" 
                      title="Delete"
                      onClick={e => { e.stopPropagation(); deleteTarget(t.id); }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <button 
            className="btn btn-ghost btn-full" 
            onClick={saveTarget}
            disabled={isRunning || !cfg.host.trim()}
          >
            ＋ Save Current Configuration
          </button>
        </div>
      </div>

        {/* ── Results panel ── */}
        <div className="results-panel">
          {/* Summary cards */}
          {summary && (
            <div className="summary-cards">
              <div className="summary-card">
                <div className="summary-label">Average</div>
                <div className="summary-value cyan">{summary.avg_mbps} <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7 }}>Mbps</span></div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--cyan)', opacity: 0.85, marginTop: '2px' }}>
                  {(summary.avg_mbps / 8).toFixed(2)} <span style={{ fontSize: '12px', fontWeight: 500, opacity: 0.7 }}>MB/s</span>
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Peak</div>
                <div className="summary-value green">{summary.max_mbps} <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7 }}>Mbps</span></div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--green)', opacity: 0.85, marginTop: '2px' }}>
                  {(summary.max_mbps / 8).toFixed(2)} <span style={{ fontSize: '12px', fontWeight: 500, opacity: 0.7 }}>MB/s</span>
                </div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Minimum</div>
                <div className="summary-value yellow">{summary.min_mbps} <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7 }}>Mbps</span></div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--yellow)', opacity: 0.85, marginTop: '2px' }}>
                  {(summary.min_mbps / 8).toFixed(2)} <span style={{ fontSize: '12px', fontWeight: 500, opacity: 0.7 }}>MB/s</span>
                </div>
              </div>
            </div>
          )}

          {/* Live chart */}
          {(isRunning || liveData.length > 0) && (
            <div className="card">
              <h2 className="card-title">
                📈 Live Throughput
                {isRunning && <span className="live-badge">● LIVE</span>}
              </h2>
              <LiveChart data={liveData} isRunning={isRunning} />
            </div>
          )}

          {/* Log output */}
          {logs.length > 0 && (
            <div className="card">
              <h2 className="card-title">🖥️ Output</h2>
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

          {/* Empty state */}
          {status === 'idle' && (
            <div className="card empty-state">
              <div className="empty-icon">⚡</div>
              <div className="empty-title">Ready to test</div>
              <div className="empty-subtitle">
                Fill in the configuration and click <strong>Run Test</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
