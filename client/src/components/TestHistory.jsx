import { useState, useEffect } from 'react'
import LiveChart from './LiveChart'

export default function TestHistory() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then(d => setHistory(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────
  const deleteOne = async id => {
    await fetch(`/api/history/${id}`, { method: 'DELETE' })
    setHistory(prev => prev.filter(h => h.id !== id))
    if (expanded === id) setExpanded(null)
  }

  const clearAll = async () => {
    if (!window.confirm('Clear all test history?')) return
    await fetch('/api/history', { method: 'DELETE' })
    setHistory([])
    setExpanded(null)
  }

  const exportOne = entry => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `iperf3-${entry.config.host}-${entry.id.slice(0, 8)}.json`,
    })
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggle = id => setExpanded(prev => (prev === id ? null : id))

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmtDate = iso =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading">Loading history</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Test History</h1>
          <p className="page-subtitle">
            {history.length} test{history.length !== 1 ? 's' : ''} recorded
          </p>
        </div>
        {history.length > 0 && (
          <button className="btn btn-danger" onClick={clearAll}>
            🗑 Clear All
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon">📊</div>
          <div className="empty-title">No tests yet</div>
          <div className="empty-subtitle">
            Run a client test — results will appear here automatically
          </div>
        </div>
      ) : (
        <div className="history-list">
          {history.map(entry => {
            const open = expanded === entry.id
            const cfg  = entry.config

            return (
              <div key={entry.id} className={`history-item ${open ? 'expanded' : ''}`}>
                {/* ── Row ── */}
                <div className="history-header" onClick={() => toggle(entry.id)}>
                  <div className="history-meta">
                    <span className={`protocol-tag ${cfg.protocol}`}>
                      {cfg.protocol.toUpperCase()}
                    </span>
                    <span className="history-host">
                      {cfg.host}:{cfg.port}
                    </span>
                    <span className="history-date">{fmtDate(entry.started_at)}</span>
                    {cfg.reverse && (
                      <span style={{ fontSize: 10, color: 'var(--yellow)', background: 'var(--yellow-dim)', padding: '1px 6px', borderRadius: 4 }}>
                        ↓ REV
                      </span>
                    )}
                    {cfg.bidir && (
                      <span style={{ fontSize: 10, color: 'var(--purple)', background: 'rgba(168,85,247,0.12)', padding: '1px 6px', borderRadius: 4 }}>
                        ↕ BIDIR
                      </span>
                    )}
                    {cfg.parallel > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                        ×{cfg.parallel}
                      </span>
                    )}
                  </div>

                  <div className="history-stats">
                    {entry.summary && (
                      <>
                        <div className="stat">
                          <div className="stat-label">Avg</div>
                          <div className="stat-value cyan">{entry.summary.avg_mbps} <span style={{ fontSize: '10px', opacity: 0.7 }}>Mbps</span></div>
                          <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--cyan)', opacity: 0.8, marginTop: '1px' }}>
                            {(entry.summary.avg_mbps / 8).toFixed(2)} <span style={{ fontSize: '9px', opacity: 0.7 }}>MB/s</span>
                          </div>
                        </div>
                        <div className="stat">
                          <div className="stat-label">Peak</div>
                          <div className="stat-value green">{entry.summary.max_mbps} <span style={{ fontSize: '10px', opacity: 0.7 }}>Mbps</span></div>
                          <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--green)', opacity: 0.8, marginTop: '1px' }}>
                            {(entry.summary.max_mbps / 8).toFixed(2)} <span style={{ fontSize: '9px', opacity: 0.7 }}>MB/s</span>
                          </div>
                        </div>
                        <div className="stat">
                          <div className="stat-label">Duration</div>
                          <div className="stat-value" style={{ lineHeight: '1.8' }}>{cfg.duration}s</div>
                        </div>
                      </>
                    )}
                    <div className="history-actions">
                      <button
                        className="btn-icon"
                        title="Export JSON"
                        onClick={e => { e.stopPropagation(); exportOne(entry) }}
                      >⬇</button>
                      <button
                        className="btn-icon danger"
                        title="Delete"
                        onClick={e => { e.stopPropagation(); deleteOne(entry.id) }}
                      >✕</button>
                    </div>
                    <span className={`expand-icon ${open ? 'expanded' : ''}`}>▼</span>
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {open && (
                  <div className="history-detail">
                    {/* Config chips */}
                    <div className="detail-grid">
                      <div className="detail-chip">
                        <span>Protocol</span>
                        <strong>{cfg.protocol.toUpperCase()}</strong>
                      </div>
                      <div className="detail-chip">
                        <span>Duration</span>
                        <strong>{cfg.duration} s</strong>
                      </div>
                      <div className="detail-chip">
                        <span>Parallel</span>
                        <strong>{cfg.parallel} stream{cfg.parallel > 1 ? 's' : ''}</strong>
                      </div>
                      {cfg.bandwidth && (
                        <div className="detail-chip">
                          <span>UDP Bandwidth</span>
                          <strong>{cfg.bandwidth}</strong>
                        </div>
                      )}
                      {cfg.buffer_length && (
                        <div className="detail-chip">
                          <span>Buffer</span>
                          <strong>{cfg.buffer_length}</strong>
                        </div>
                      )}
                      <div className="detail-chip">
                        <span>Direction</span>
                        <strong>{cfg.bidir ? 'Bidirectional' : cfg.reverse ? 'Reverse' : 'Upload'}</strong>
                      </div>
                    </div>

                    {/* Chart */}
                    {entry.intervals?.length > 0 && (
                      <LiveChart data={entry.intervals} isRunning={false} />
                    )}

                    {/* Command */}
                    {entry.command && (
                      <div style={{ marginTop: 12 }}>
                        <div className="form-label">Command used</div>
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
                          {entry.command}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
