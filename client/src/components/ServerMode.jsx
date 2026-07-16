import { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_CONFIG = { port: 5201, bind_address: '', one_off: false }

export default function ServerMode({ onStatusChange }) {
  const [config, setConfig]   = useState(DEFAULT_CONFIG)
  const [status, setStatus]   = useState('stopped')
  const [loading, setLoading] = useState(false)
  const [logs, setLogs]       = useState([])

  const wsRef      = useRef(null)
  const logsEndRef = useRef(null)
  const reconnectRef = useRef(null)

  // ── Auto-scroll log ──────────────────────────────────────────────────────
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const addLog = (text, type = '') =>
    setLogs(prev => [
      ...prev.slice(-600),
      { id: Date.now() + Math.random(), text, type, time: new Date().toLocaleTimeString() },
    ])

  // ── WebSocket ────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/server`)
    wsRef.current = ws

    ws.onmessage = e => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'status') {
        setStatus(msg.status)
        onStatusChange?.(msg.status)
      } else if (msg.type === 'started') {
        setStatus('running')
        onStatusChange?.('running')
        addLog(msg.message, 'success')
      } else if (msg.type === 'log') {
        addLog(msg.message)
      } else if (msg.type === 'stopped') {
        setStatus('stopped')
        onStatusChange?.('stopped')
        addLog(msg.message, 'info')
      }
    }

    ws.onclose = () => {
      reconnectRef.current = setTimeout(connect, 2500)
    }

    ws.onerror = () => ws.close()
  }, [onStatusChange])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // ── Initial status fetch ─────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/server/status')
      .then(r => r.json())
      .then(d => {
        setStatus(d.status)
        onStatusChange?.(d.status)
        if (d.config && Object.keys(d.config).length) {
          setConfig(c => ({ ...c, port: d.config.port ?? c.port }))
        }
      })
      .catch(() => {})
  }, [onStatusChange])

  // ── Controls ─────────────────────────────────────────────────────────────
  const startServer = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/server/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to start server')
      addLog(`▶ ${data.command}`, 'info')
    } catch (err) {
      addLog(`✗ ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const stopServer = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/server/stop', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.detail)
      }
    } catch (err) {
      addLog(`✗ ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const isRunning = status === 'running'

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Server Mode</h1>
          <p className="page-subtitle">Run iPerf3 as a server to accept incoming test connections</p>
        </div>
        <div className={`status-badge ${status}`}>
          <span className="status-dot" />
          {isRunning ? 'Running' : 'Stopped'}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="two-col">
        {/* ── Config card ── */}
        <div className="card">
          <h2 className="card-title">⚙️ Configuration</h2>

          <div className="form-group">
            <label className="form-label">Port</label>
            <input
              type="number"
              className="form-input"
              value={config.port}
              onChange={e => setConfig(c => ({ ...c, port: Number(e.target.value) }))}
              disabled={isRunning}
              min={1024}
              max={65535}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Bind Address <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              className="form-input"
              value={config.bind_address}
              onChange={e => setConfig(c => ({ ...c, bind_address: e.target.value }))}
              disabled={isRunning}
              placeholder="0.0.0.0"
            />
          </div>

          <div className="form-group">
            <label className="toggle">
              <input
                type="checkbox"
                checked={config.one_off}
                onChange={e => setConfig(c => ({ ...c, one_off: e.target.checked }))}
                disabled={isRunning}
              />
              <span className="toggle-track" />
              <span className="toggle-label">One-off mode (stop after first test)</span>
            </label>
          </div>

          {/* Action button */}
          <div className="btn-group">
            {!isRunning ? (
              <button
                className="btn btn-success btn-full"
                onClick={startServer}
                disabled={loading}
              >
                {loading ? '⏳ Starting…' : '▶ Start Server'}
              </button>
            ) : (
              <button
                className="btn btn-danger btn-full"
                onClick={stopServer}
                disabled={loading}
              >
                {loading ? '⏳ Stopping…' : '■ Stop Server'}
              </button>
            )}
          </div>

          {/* Running info */}
          {isRunning && (
            <div className="info-box">
              <div className="info-row"><span>Status</span><strong>● Running</strong></div>
              <div className="info-row"><span>Port</span><strong>:{config.port}</strong></div>
              <div className="info-row"><span>Bind</span><strong>{config.bind_address || '0.0.0.0'}</strong></div>
              <div className="info-row"><span>Mode</span><strong>{config.one_off ? 'One-off' : 'Continuous'}</strong></div>
            </div>
          )}
        </div>

        {/* ── Live log card ── */}
        <div className="card">
          <div className="card-header-row">
            <h2 className="card-title">📋 Live Log</h2>
            <button className="btn-text" onClick={() => setLogs([])}>Clear</button>
          </div>
          <div className="log-console">
            {logs.length === 0 ? (
              <div className="log-empty">
                {isRunning ? 'Waiting for connections…' : 'Start the server to see logs'}
              </div>
            ) : (
              logs.map(log => (
                <div key={log.id} className={`log-line ${log.type}`}>
                  <span className="log-time">{log.time}</span>
                  <span className="log-text">{log.text}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
