import { useState } from 'react'

const PRESET_TARGETS = [
  'google.com',
  'cloudflare.com',
  'github.com',
  'microsoft.com',
  'wikipedia.org',
]

export default function SslAnalyzer() {
  const [target, setTarget] = useState('google.com')
  const [port, setPort] = useState(443)
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
    <div className='tab-panel'>
      <div className='section-header' style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className='section-title'>🔐 SSL / TLS Certificate Analyzer</div>
          <div className='section-desc'>
            Inspect HTTPS certificates, validity dates, certificate authority (CA), TLS protocol version, and cipher suites
          </div>
        </div>
      </div>

      <div className='card' style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <label className='form-label'>Host / Domain / IP</label>
            <input
              type='text'
              className='input'
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder='e.g. google.com, api.internal:8443, 10.1.1.5'
              onKeyDown={e => e.key === 'Enter' && handleInspect()}
            />
          </div>

          <div style={{ width: 110 }}>
            <label className='form-label'>Port</label>
            <input
              type='number'
              className='input'
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder='443'
            />
          </div>

          <button
            className='btn btn-primary'
            onClick={() => handleInspect()}
            disabled={loading || !target.trim()}
            style={{ height: 38, minWidth: 140 }}
          >
            {loading ? 'Inspecting...' : '🔍 Inspect SSL'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quick Presets:</span>
          {PRESET_TARGETS.map(p => (
            <button
              key={p}
              className='btn-tiny'
              style={{ background: 'rgba(255,255,255,0.05)' }}
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

      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          color: '#f87171',
          marginBottom: 20,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className='card' style={{
            background: result.status === 'valid'
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)'
              : result.status === 'expiring_soon'
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)',
            border: '1px solid ' + (result.status === 'valid' ? 'rgba(16, 185, 129, 0.3)' : result.status === 'expiring_soon' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)')
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  fontSize: 36,
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: result.status === 'valid' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'
                }}>
                  {result.status === 'valid' ? '🛡️' : result.status === 'expiring_soon' ? '⏳' : '❌'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 600 }}>{result.host}:{result.port}</span>
                    <span className={'status-badge ' + result.badge_color} style={{ textTransform: 'uppercase', fontSize: 11, padding: '2px 8px' }}>
                      {result.status.replace('_', ' ')}
                    </span>
                    {result.verified ? (
                      <span className='status-badge green' style={{ fontSize: 11, padding: '2px 8px' }}>
                        ✓ Trusted Root CA
                      </span>
                    ) : (
                      <span className='status-badge amber' style={{ fontSize: 11, padding: '2px 8px' }} title={result.verify_error}>
                        ⚠️ Untrusted / Self-Signed
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Common Name: <strong style={{ color: 'var(--text-primary)' }}>{result.certificate?.subject || '-'}</strong>
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: result.status === 'valid' ? '#10b981' : result.status === 'expiring_soon' ? '#f59e0b' : '#ef4444'
                }}>
                  {result.certificate?.days_remaining >= 0 ? result.certificate.days_remaining + ' Days' : 'EXPIRED'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {result.certificate?.days_remaining >= 0 ? 'Remaining until expiration' : 'Certificate has expired'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div className='card' style={{ padding: 14 }}>
              <div className='detail-label' style={{ marginBottom: 4 }}>Negotiated TLS Protocol</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--cyan)' }}>
                {result.tls_version}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                ALPN Protocol: {result.alpn || 'None'}
              </div>
            </div>

            <div className='card' style={{ padding: 14 }}>
              <div className='detail-label' style={{ marginBottom: 4 }}>Cipher Suite</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {result.cipher?.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Strength: {result.cipher?.bits}-bit
              </div>
            </div>

            <div className='card' style={{ padding: 14 }}>
              <div className='detail-label' style={{ marginBottom: 4 }}>Valid From</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {result.certificate?.valid_from ? new Date(result.certificate.valid_from).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}
              </div>
            </div>

            <div className='card' style={{ padding: 14 }}>
              <div className='detail-label' style={{ marginBottom: 4 }}>Valid Until (Expiration)</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: result.status === 'valid' ? 'inherit' : '#f59e0b' }}>
                {result.certificate?.valid_until ? new Date(result.certificate.valid_until).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-'}
              </div>
            </div>
          </div>

          <div className='card'>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
              📜 Certificate Authority & Subject Information
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div className='detail-label' style={{ marginBottom: 4 }}>Subject (Issued To)</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {result.certificate?.subject || '-'}
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <div className='detail-label' style={{ marginBottom: 4 }}>Issuer (Issued By / CA)</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {result.certificate?.issuer || '-'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 14 }}>
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

          {result.certificate?.sans && result.certificate.sans.length > 0 && (
            <div className='card'>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🌐</span> Subject Alternative Names (SANs)
                  <span className='badge' style={{ fontSize: 11, marginLeft: 6 }}>{result.certificate.sans.length} Total</span>
                </div>
                <input
                  type='text'
                  className='input'
                  style={{ width: 220, height: 30, fontSize: 12 }}
                  placeholder='Filter domains...'
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
                padding: 10,
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 8,
                border: '1px solid var(--border)'
              }}>
                {filteredSans.map((san, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: san.startsWith('*') ? 'var(--cyan)' : 'var(--text-primary)'
                    }}
                  >
                    {san}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className='btn btn-secondary btn-sm' onClick={copyJson}>
              {copied ? '✓ Copied JSON' : '📋 Copy JSON Result'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
