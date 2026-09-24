import { useState, useEffect } from 'react'

const PRESET_TARGETS = [
  'google.com',
  'cloudflare.com',
  'github.com',
  'microsoft.com',
  'wikipedia.org',
]

export default function SslAnalyzer({ initialHost }) {
  const [target, setTarget] = useState(initialHost || 'google.com')
  const [port, setPort] = useState(443)

  useEffect(() => {
    if (initialHost) {
      setTarget(initialHost)
    }
  }, [initialHost])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [sanSearch, setSanSearch] = useState('')

  const handleInspect = async (hostToInspect = target) => {
    const trimmed = hostToInspect.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/ssl/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: trimmed,
          port: parseInt(port, 10) || 443,
          timeout: 8.0,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setResult(data)
      } else {
        const errData = await res.json().catch(() => ({}))
        setError(errData.detail || 'Server responded with error')
      }
    } catch (err) {
      setError('Network error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyJson = () => {
    if (!result) return
    navigator.clipboard.writeText(JSON.stringify(result, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredSans = (result?.certificate?.sans || []).filter(name =>
    name.toLowerCase().includes(sanSearch.toLowerCase())
  )

  return (
    <div className="tab-page">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">SSL / TLS Certificate Analyzer</h1>
          <p className="page-subtitle">
            Inspect HTTPS certificates, expiration dates, Certificate Authorities (CA), TLS versions, and cipher suites
          </p>
        </div>
        <div className={`status-badge ${loading ? 'running' : result ? 'complete' : 'ready'}`}>
          <span className="status-dot" />
          {loading ? 'Inspecting…' : result ? 'Inspected' : 'Ready'}
        </div>
      </div>

      {/* ── Configuration Card ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title">⚙️ Target & Handshake Settings</h2>

        <div className="form-grid-3" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Target (Domain / Hostname / IP)</label>
            <input
              type="text"
              className="form-input"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="e.g. google.com, api.internal:8443, 10.1.1.5"
              onKeyDown={e => e.key === 'Enter' && handleInspect()}
              disabled={loading}
              style={{ fontFamily: 'monospace', fontWeight: 500, height: 42 }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0, width: 140 }}>
            <label className="form-label">Port</label>
            <input
              type="number"
              className="form-input"
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="443"
              disabled={loading}
              style={{ fontFamily: 'monospace', fontWeight: 500, height: 42 }}
            />
          </div>

          <button
            className="btn btn-primary"
            onClick={() => handleInspect()}
            disabled={loading || !target.trim()}
            style={{ height: 42, padding: '0 24px', fontWeight: 600, minWidth: 150 }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, marginRight: 8 }} />
                Inspecting...
              </>
            ) : (
              '🔍 Inspect SSL'
            )}
          </button>
        </div>

        {/* Quick Target Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
            Quick Presets:
          </span>
          {PRESET_TARGETS.map(p => (
            <button
              key={p}
              className="btn-tiny"
              style={{
                borderRadius: 20,
                padding: '4px 12px',
                background: target === p ? 'var(--cyan-dim)' : 'rgba(255,255,255,0.04)',
                color: target === p ? 'var(--cyan)' : 'var(--text-secondary)',
                borderColor: target === p ? 'rgba(0, 212, 255, 0.3)' : 'var(--border)'
              }}
              onClick={() => {
                setTarget(p)
                handleInspect(p)
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div style={{
          padding: '14px 18px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          color: '#f87171',
          marginBottom: 24,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* ── Inspection Results ── */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Status Hero Card */}
          <div className="card" style={{
            background: result.status === 'valid'
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.7) 100%)'
              : result.status === 'expiring_soon'
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.7) 100%)'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(15, 23, 42, 0.7) 100%)',
            border: `1px solid ${
              result.status === 'valid'
                ? 'rgba(16, 185, 129, 0.35)'
                : result.status === 'expiring_soon'
                ? 'rgba(245, 158, 11, 0.35)'
                : 'rgba(239, 68, 68, 0.35)'
            }`
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  fontSize: 32,
                  width: 58,
                  height: 58,
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: result.status === 'valid'
                    ? 'rgba(16, 185, 129, 0.15)'
                    : result.status === 'expiring_soon'
                    ? 'rgba(245, 158, 11, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}>
                  {result.status === 'valid' ? '🛡️' : result.status === 'expiring_soon' ? '⏳' : '❌'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>
                      {result.host}:{result.port}
                    </span>
                    <span className={`status-badge ${result.badge_color}`} style={{ textTransform: 'uppercase', fontSize: 11, padding: '3px 10px', fontWeight: 600 }}>
                      {result.status.replace('_', ' ')}
                    </span>
                    {result.verified ? (
                      <span className="status-badge green" style={{ fontSize: 11, padding: '3px 10px', fontWeight: 600 }}>
                        ✓ Trusted Root CA
                      </span>
                    ) : (
                      <span className="status-badge amber" style={{ fontSize: 11, padding: '3px 10px', fontWeight: 600 }} title={result.verify_error}>
                        ⚠️ Untrusted / Self-Signed
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    Issued To: <strong style={{ color: 'var(--cyan)' }}>{result.certificate?.subject || '-'}</strong>
                  </div>
                </div>
              </div>

              {/* Days Countdown */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 32,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  letterSpacing: '-0.02em',
                  color: result.status === 'valid' ? '#10b981' : result.status === 'expiring_soon' ? '#f59e0b' : '#ef4444'
                }}>
                  {result.certificate?.days_remaining >= 0 ? `${result.certificate.days_remaining} Days` : 'EXPIRED'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {result.certificate?.days_remaining >= 0 ? 'Remaining until expiration' : 'Certificate is no longer valid'}
                </div>
              </div>
            </div>
          </div>

          {/* Key TLS & Cipher Details Grid */}
          <div className="host-details-grid">
            <div className="detail-card">
              <div className="detail-label">Negotiated TLS Protocol</div>
              <div className="detail-value" style={{ color: 'var(--cyan)', fontSize: 16 }}>
                {result.tls_version}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                ALPN: {result.alpn || 'None'}
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-label">Cipher Suite</div>
              <div className="detail-value" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                {result.cipher?.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Key Strength: {result.cipher?.bits}-bit
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-label">Valid From</div>
              <div className="detail-value" style={{ fontSize: 13 }}>
                {result.certificate?.valid_from ? new Date(result.certificate.valid_from).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {result.certificate?.valid_from ? new Date(result.certificate.valid_from).toLocaleTimeString() : ''}
              </div>
            </div>

            <div className="detail-card">
              <div className="detail-label">Valid Until (Expiration)</div>
              <div className="detail-value" style={{ fontSize: 13, color: result.status === 'valid' ? 'inherit' : '#f59e0b' }}>
                {result.certificate?.valid_until ? new Date(result.certificate.valid_until).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {result.certificate?.valid_until ? new Date(result.certificate.valid_until).toLocaleTimeString() : ''}
              </div>
            </div>
          </div>

          {/* Certificate Hierarchy & Identity Details */}
          <div className="card">
            <h2 className="card-title">📜 Certificate Authority & Subject Information</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div className="detail-card">
                <div className="detail-label">Subject (Issued To)</div>
                <div className="detail-value" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {result.certificate?.subject || '-'}
                </div>
              </div>

              <div className="detail-card">
                <div className="detail-label">Issuer (Certificate Authority / CA)</div>
                <div className="detail-value" style={{ fontSize: 13, lineHeight: 1.5, color: '#38bdf8' }}>
                  {result.certificate?.issuer || '-'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 14 }}>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Signature Algorithm: </span>
                <span style={{ fontFamily: 'monospace', color: 'var(--cyan)' }}>{result.certificate?.signature_algorithm || '-'}</span>
              </div>
              <div style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Serial Number: </span>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{result.certificate?.serial_number || '-'}</span>
              </div>
            </div>
          </div>

          {/* Subject Alternative Names (SANs) */}
          {result.certificate?.sans && result.certificate.sans.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <h2 className="card-title" style={{ marginBottom: 0 }}>
                  🌐 Subject Alternative Names (SANs)
                  <span className="badge" style={{ fontSize: 11, marginLeft: 8 }}>{result.certificate.sans.length} Total</span>
                </h2>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: 240, height: 34, fontSize: 12 }}
                  placeholder="Filter domain names..."
                  value={sanSearch}
                  onChange={e => setSanSearch(e.target.value)}
                />
              </div>

              <div style={{
                maxHeight: 180,
                overflowY: 'auto',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                padding: 12,
                background: 'rgba(0,0,0,0.25)',
                borderRadius: 8,
                border: '1px solid var(--border)'
              }}>
                {filteredSans.map((san, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      padding: '4px 10px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: san.startsWith('*') ? 'var(--cyan)' : 'var(--text-primary)'
                    }}
                  >
                    {san}
                  </span>
                ))}
                {filteredSans.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                    No matching SAN domains found.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raw JSON Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={copyJson} style={{ fontSize: 12 }}>
              {copied ? '✓ Copied JSON' : '📋 Copy JSON Result'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
