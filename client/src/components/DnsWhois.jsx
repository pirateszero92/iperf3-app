import { useState } from 'react'

const COMMON_RECORD_TYPES = ['ALL', 'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA']
const NAMESERVER_PRESETS = [
  { label: 'System Default', value: '' },
  { label: 'Cloudflare (1.1.1.1)', value: '1.1.1.1' },
  { label: 'Google (8.8.8.8)', value: '8.8.8.8' },
  { label: 'Quad9 (9.9.9.9)', value: '9.9.9.9' },
  { label: 'OpenDNS (208.67.222.222)', value: '208.67.222.222' },
]

export default function DnsWhois() {
  const [activeSubTab, setActiveSubTab] = useState('dns') // 'dns' | 'resolve' | 'whois'

  // DNS Lookup state
  const [dnsTarget, setDnsTarget] = useState('google.com')
  const [recordType, setRecordType] = useState('ALL')
  const [nameserver, setNameserver] = useState('')
  const [dnsLoading, setDnsLoading] = useState(false)
  const [dnsResult, setDnsResult] = useState(null)
  const [dnsRawOpen, setDnsRawOpen] = useState(false)

  // Resolve (Reverse DNS) state
  const [resolveInput, setResolveInput] = useState('8.8.8.8\n1.1.1.1\n9.9.9.9')
  const [resolveLoading, setResolveLoading] = useState(false)
  const [resolveResults, setResolveResults] = useState([])

  // WHOIS state
  const [whoisTarget, setWhoisTarget] = useState('google.com')
  const [whoisLoading, setWhoisLoading] = useState(false)
  const [whoisResult, setWhoisResult] = useState(null)

  // Handlers
  const handleDnsLookup = async () => {
    if (!dnsTarget.trim() || dnsLoading) return
    setDnsLoading(true)
    setDnsResult(null)

    try {
      const res = await fetch('/api/dns/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: dnsTarget.trim(),
          record_type: recordType,
          nameserver: nameserver.trim() || null,
        })
      })

      if (res.ok) {
        const data = await res.json()
        setDnsResult(data)
      } else {
        const err = await res.json()
        alert(`DNS Lookup error: ${err.detail || 'Failed'}`)
      }
    } catch (e) {
      alert(`Network error: ${e.message}`)
    } finally {
      setDnsLoading(false)
    }
  }

  const handleResolve = async () => {
    if (!resolveInput.trim() || resolveLoading) return
    setResolveLoading(true)
    const ips = resolveInput
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    try {
      const res = await fetch('/api/dns/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips })
      })

      if (res.ok) {
        const data = await res.json()
        setResolveResults(data.results || [])
      }
    } catch (e) {
      alert(`Resolve error: ${e.message}`)
    } finally {
      setResolveLoading(false)
    }
  }

  const handleWhois = async () => {
    if (!whoisTarget.trim() || whoisLoading) return
    setWhoisLoading(true)
    setWhoisResult(null)

    try {
      const res = await fetch('/api/whois/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: whoisTarget.trim() })
      })

      if (res.ok) {
        const data = await res.json()
        setWhoisResult(data)
      } else {
        const err = await res.json()
        alert(`WHOIS error: ${err.detail || 'Failed'}`)
      }
    } catch (e) {
      alert(`WHOIS error: ${e.message}`)
    } finally {
      setWhoisLoading(false)
    }
  }

  return (
    <div className="tab-page">
      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>DNS & WHOIS Intelligence Suite</h2>
          <p className="page-desc">Comprehensive DNS record lookup, reverse IP resolve, and WHOIS domain/IP registration analysis</p>
        </div>
      </div>

      {/* ── Sub Navigation ── */}
      <div className="tab-buttons-container" style={{ marginBottom: 16 }}>
        <button
          className={`tab-btn ${activeSubTab === 'dns' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('dns')}
        >
          🔍 DNS Lookup & Analyzer
        </button>
        <button
          className={`tab-btn ${activeSubTab === 'resolve' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('resolve')}
        >
          🔄 Reverse DNS (Resolve)
        </button>
        <button
          className={`tab-btn ${activeSubTab === 'whois' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('whois')}
        >
          📋 WHOIS Lookup
        </button>
      </div>

      {/* ── Section 1: DNS Lookup ── */}
      {activeSubTab === 'dns' && (
        <div className="dns-lookup-panel">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="form-row-multi">
              <div style={{ flex: 2 }}>
                <label className="field-label">Domain Name / Hostname:</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. google.com or cloudflare.com"
                  value={dnsTarget}
                  onChange={(e) => setDnsTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDnsLookup()}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label className="field-label">Record Type:</label>
                <select
                  className="select-field"
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value)}
                >
                  {COMMON_RECORD_TYPES.map(rt => (
                    <option key={rt} value={rt}>{rt}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1.5 }}>
                <label className="field-label">Nameserver Server:</label>
                <select
                  className="select-field"
                  value={nameserver}
                  onChange={(e) => setNameserver(e.target.value)}
                >
                  {NAMESERVER_PRESETS.map(ns => (
                    <option key={ns.label} value={ns.value}>{ns.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ alignSelf: 'flex-end' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleDnsLookup}
                  disabled={dnsLoading || !dnsTarget.trim()}
                  style={{ minWidth: 120 }}
                >
                  {dnsLoading ? '⏳ Querying...' : '▶ Query DNS'}
                </button>
              </div>
            </div>
          </div>

          {/* Results View */}
          {dnsResult && (
            <div className="card">
              <div className="dns-summary-header">
                <div className="dns-summary-info">
                  <strong>Query: {dnsResult.target}</strong>
                  <span className="pill-badge">Server: {dnsResult.nameserver}</span>
                  <span className="pill-badge pill-latency">⚡ {dnsResult.latency_ms} ms</span>
                  <span className="pill-badge">{dnsResult.records.length} Records Found</span>
                </div>
                <button
                  className="btn-tiny"
                  onClick={() => setDnsRawOpen(!dnsRawOpen)}
                >
                  {dnsRawOpen ? 'Hide Raw Output' : 'View Raw Dig Output'}
                </button>
              </div>

              {dnsRawOpen && (
                <pre className="raw-output-box">{dnsResult.raw_output}</pre>
              )}

              <div className="table-responsive" style={{ marginTop: 12 }}>
                {dnsResult.records.length === 0 ? (
                  <div className="empty-state">No DNS records returned for the specified query.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Type</th>
                        <th>Name</th>
                        <th>Value / Target</th>
                        <th style={{ width: 100 }}>TTL</th>
                        <th style={{ width: 90 }}>Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dnsResult.records.map((rec, i) => (
                        <tr key={i}>
                          <td><span className={`dns-type-badge type-${rec.type}`}>{rec.type}</span></td>
                          <td><code>{rec.name}</code></td>
                          <td style={{ fontWeight: 500, wordBreak: 'break-all' }}>{rec.value}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{rec.ttl}s</td>
                          <td>{rec.priority !== null && rec.priority !== undefined ? rec.priority : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: Reverse DNS (Resolve) ── */}
      {activeSubTab === 'resolve' && (
        <div className="dns-resolve-panel">
          <div className="card" style={{ marginBottom: 16 }}>
            <label className="field-label">IP Addresses to Resolve (one per line, up to 50):</label>
            <textarea
              className="textarea-field"
              rows={4}
              value={resolveInput}
              onChange={(e) => setResolveInput(e.target.value)}
              placeholder="e.g.&#10;8.8.8.8&#10;1.1.1.1&#10;192.168.1.1"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                className="btn btn-primary"
                onClick={handleResolve}
                disabled={resolveLoading}
              >
                {resolveLoading ? '⏳ Resolving...' : '🔄 Resolve PTR Records'}
              </button>
            </div>
          </div>

          {resolveResults.length > 0 && (
            <div className="card">
              <h3>Resolution Results</h3>
              <div className="table-responsive" style={{ marginTop: 10 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>IP Address</th>
                      <th>Resolved Hostname</th>
                      <th>Status</th>
                      <th>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolveResults.map((item, idx) => (
                      <tr key={idx}>
                        <td><code>{item.ip}</code></td>
                        <td style={{ fontWeight: item.status === 'resolved' ? 600 : 400, color: item.status === 'resolved' ? 'var(--accent)' : 'inherit' }}>
                          {item.hostname}
                        </td>
                        <td>
                          <span className={`state-badge ${item.status === 'resolved' ? 'open' : 'closed'}`}>
                            {item.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{item.latency_ms} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: WHOIS Lookup ── */}
      {activeSubTab === 'whois' && (
        <div className="whois-panel">
          <div className="card" style={{ marginBottom: 16 }}>
            <label className="field-label">Domain Name or IP Address:</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. google.com or 8.8.8.8"
                value={whoisTarget}
                onChange={(e) => setWhoisTarget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleWhois()}
              />
              <button
                className="btn btn-primary"
                onClick={handleWhois}
                disabled={whoisLoading || !whoisTarget.trim()}
                style={{ minWidth: 140 }}
              >
                {whoisLoading ? '⏳ Looking up...' : '📋 Query WHOIS'}
              </button>
            </div>
          </div>

          {whoisResult && (
            <div className="card">
              <h3>WHOIS Record: {whoisResult.target}</h3>

              {/* Parsed Overview Grid */}
              <div className="host-details-grid" style={{ marginTop: 12, marginBottom: 16 }}>
                <div className="detail-card">
                  <div className="detail-label">Registrar</div>
                  <div className="detail-value">{whoisResult.parsed?.registrar || '-'}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Organization</div>
                  <div className="detail-value">{whoisResult.parsed?.organization || '-'}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Created Date</div>
                  <div className="detail-value">{whoisResult.parsed?.created_date || '-'}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Expiry Date</div>
                  <div className="detail-value" style={{ color: 'var(--accent)' }}>{whoisResult.parsed?.expiry_date || '-'}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">Domain Status</div>
                  <div className="detail-value">{whoisResult.parsed?.status || '-'}</div>
                </div>
                <div className="detail-card">
                  <div className="detail-label">CIDR / ASN</div>
                  <div className="detail-value">{whoisResult.parsed?.cidr || whoisResult.parsed?.asn || '-'}</div>
                </div>
                <div className="detail-card full-width">
                  <div className="detail-label">Name Servers</div>
                  <div className="detail-value" style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {(whoisResult.parsed?.name_servers || []).join(', ') || '-'}
                  </div>
                </div>
              </div>

              {/* Raw WHOIS Output */}
              <div className="raw-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Full WHOIS Raw Output:</strong>
                <button
                  className="btn-tiny"
                  onClick={() => navigator.clipboard.writeText(whoisResult.raw_output)}
                >
                  📋 Copy Text
                </button>
              </div>
              <pre className="raw-output-box" style={{ maxHeight: 350 }}>
                {whoisResult.raw_output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
