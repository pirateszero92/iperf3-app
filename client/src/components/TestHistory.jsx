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
            const cfg = entry.config || {}
            const isTrace = entry.type === 'trace' || !!entry.hops

            return (
              <div key={entry.id} className={`history-item ${open ? 'expanded' : ''}`}>
                {/* ── Row ── */}
                <div className="history-header" onClick={() => toggle(entry.id)}>
                  <div className="history-meta">
                    <span className={`protocol-tag ${isTrace ? 'udp' : (cfg.protocol || 'tcp')}`} style={isTrace ? { background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' } : {}}>
                      {isTrace ? '📍 TRACE' : (cfg.protocol || 'TCP').toUpperCase()}
                    </span>
                    <span className="history-host">
                      {cfg.host}{cfg.port ? `:${cfg.port}` : ''}
                    </span>
                    <span className="history-date">{fmtDate(entry.started_at)}</span>
                    {!isTrace && cfg.reverse && (
                      <span style={{ fontSize: 10, color: 'var(--yellow)', background: 'var(--yellow-dim)', padding: '1px 6px', borderRadius: 4 }}>
                        ↓ REV
                      </span>
                    )}
                    {!isTrace && cfg.bidir && (
                      <span style={{ fontSize: 10, color: 'var(--purple)', background: 'rgba(168,85,247,0.12)', padding: '1px 6px', borderRadius: 4 }}>
                        ↕ BIDIR
                      </span>
                    )}
                    {!isTrace && cfg.parallel > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                        ×{cfg.parallel}
                      </span>
                    )}
                  </div>

                  <div className="history-stats">
                    {isTrace ? (
                      entry.summary && (
                        <>
                          <div className="stat">
                            <div className="stat-label">Hops</div>
                            <div className="stat-value cyan">{entry.summary.total_hops}</div>
                          </div>
                          <div className="stat">
                            <div className="stat-label">Target Latency</div>
                            <div className="stat-value green">
                              {entry.summary.target_latency !== null ? `${entry.summary.target_latency} ms` : 'N/A'}
                            </div>
                          </div>
                        </>
                      )
                    ) : (
                      entry.summary && (
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
                      )
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
                        <span>Mode</span>
                        <strong>{isTrace ? 'Route Trace' : 'iPerf3 Client'}</strong>
                      </div>
                      <div className="detail-chip">
                        <span>Protocol</span>
                        <strong>{(cfg.protocol || 'icmp').toUpperCase()}</strong>
                      </div>
                      {isTrace ? (
                        <>
                          <div className="detail-chip">
                            <span>Max Hops</span>
                            <strong>{cfg.max_hops || 30}</strong>
                          </div>
                          <div className="detail-chip">
                            <span>Repeat / Probes</span>
                            <strong>{cfg.probes || 3}</strong>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="detail-chip">
                            <span>Duration</span>
                            <strong>{cfg.duration} s</strong>
                          </div>
                          <div className="detail-chip">
                            <span>Parallel</span>
                            <strong>{cfg.parallel} stream{cfg.parallel > 1 ? 's' : ''}</strong>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Content / Chart / Table */}
                    {isTrace ? (
                      entry.hops?.length > 0 && (
                        <div style={{ overflowX: 'auto', marginTop: 12 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                <th style={{ padding: '6px 8px' }}>Hop #</th>
                                <th style={{ padding: '6px 8px' }}>IP Address</th>
                                <th style={{ padding: '6px 8px' }}>Probes</th>
                                <th style={{ padding: '6px 8px' }}>Avg Latency</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entry.hops.map(h => (
                                <tr key={h.hop} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{h.hop}</td>
                                  <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace", color: '#10b981' }}>{h.ip}</td>
                                  <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-secondary)' }}>
                                    {h.rtts ? h.rtts.map(r => `${r}ms`).join(' | ') : '*'}
                                  </td>
                                  <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--cyan)' }}>
                                    {h.avg_rtt !== null ? `${h.avg_rtt} ms` : 'Timed out'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : (
                      entry.intervals?.length > 0 && (
                        <LiveChart data={entry.intervals} isRunning={false} />
                      )
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
