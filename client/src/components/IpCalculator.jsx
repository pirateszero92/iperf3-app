import { useState, useMemo } from 'react'

// Common CIDR presets
const IPV4_PRESETS = [
  { prefix: 30, label: '/30 (Point-to-Point, 2 hosts)' },
  { prefix: 29, label: '/29 (Small LAN, 6 hosts)' },
  { prefix: 28, label: '/28 (Office, 14 hosts)' },
  { prefix: 24, label: '/24 (Standard, 254 hosts)' },
  { prefix: 22, label: '/22 (Medium, 1,022 hosts)' },
  { prefix: 16, label: '/16 (Campus, 65,534 hosts)' },
  { prefix: 8,  label: '/8 (Global, 16.7M hosts)' },
]

function intToIp(intVal) {
  return [
    (intVal >>> 24) & 255,
    (intVal >>> 16) & 255,
    (intVal >>> 8) & 255,
    intVal & 255,
  ].join('.')
}

function ipToInt(ipStr) {
  const parts = ipStr.trim().split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function calculateIpv4Local(ipStr, prefix) {
  const ipInt = ipToInt(ipStr)
  if (ipInt === null) return null
  if (prefix < 0 || prefix > 32) return null

  const maskInt = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const wildcardInt = ~maskInt >>> 0
  const netInt = (ipInt & maskInt) >>> 0
  const bcastInt = (netInt | wildcardInt) >>> 0

  const total = Math.pow(2, 32 - prefix)
  let usable = 0
  let firstUsable = ''
  let lastUsable = ''

  if (prefix === 32) {
    usable = 1
    firstUsable = intToIp(ipInt)
    lastUsable = intToIp(ipInt)
  } else if (prefix === 31) {
    usable = 2
    firstUsable = intToIp(netInt)
    lastUsable = intToIp(bcastInt)
  } else {
    usable = Math.max(0, total - 2)
    firstUsable = intToIp(netInt + 1)
    lastUsable = intToIp(bcastInt - 1)
  }

  const firstOctet = (ipInt >>> 24) & 255
  let ipClass = 'Class A'
  if (firstOctet >= 128 && firstOctet <= 191) ipClass = 'Class B'
  else if (firstOctet >= 192 && firstOctet <= 223) ipClass = 'Class C'
  else if (firstOctet >= 224 && firstOctet <= 239) ipClass = 'Class D (Multicast)'
  else if (firstOctet >= 240) ipClass = 'Class E (Experimental)'

  let scope = 'Public Internet'
  if (
    (firstOctet === 10) ||
    (firstOctet === 172 && ((ipInt >>> 16) & 255) >= 16 && ((ipInt >>> 16) & 255) <= 31) ||
    (firstOctet === 192 && ((ipInt >>> 16) & 255) === 168)
  ) {
    scope = 'Private (RFC 1918)'
  } else if (firstOctet === 127) {
    scope = 'Loopback (127.0.0.0/8)'
  } else if (firstOctet === 169 && ((ipInt >>> 16) & 255) === 254) {
    scope = 'Link-Local / APIPA (169.254.0.0/16)'
  } else if (firstOctet === 100 && ((ipInt >>> 16) & 255) >= 64 && ((ipInt >>> 16) & 255) <= 127) {
    scope = 'Carrier-Grade NAT (CGNAT RFC 6598)'
  } else if (firstOctet >= 224 && firstOctet <= 239) {
    scope = 'Multicast'
  }

  const toBin32 = n => (n >>> 0).toString(2).padStart(32, '0')

  return {
    ip: intToIp(ipInt),
    cidr: prefix,
    network: intToIp(netInt),
    broadcast: intToIp(bcastInt),
    netmask: intToIp(maskInt),
    wildcard: intToIp(wildcardInt),
    firstUsable,
    lastUsable,
    usableHosts: usable,
    totalAddresses: total,
    ipClass,
    scope,
    hex: '0x' + (ipInt >>> 0).toString(16).toUpperCase().padStart(8, '0'),
    integer: ipInt >>> 0,
    binIp: toBin32(ipInt),
    binMask: toBin32(maskInt),
    binNet: toBin32(netInt),
    binBcast: toBin32(bcastInt),
  }
}

function splitSubnetLocal(netIpStr, parentPrefix, newPrefix) {
  const ipInt = ipToInt(netIpStr)
  if (ipInt === null || newPrefix <= parentPrefix || newPrefix > 32) return []

  const parentMask = parentPrefix === 0 ? 0 : (~0 << (32 - parentPrefix)) >>> 0
  const baseNet = (ipInt & parentMask) >>> 0
  const count = Math.pow(2, newPrefix - parentPrefix)
  const safeCount = Math.min(count, 128)

  const subSize = Math.pow(2, 32 - newPrefix)
  const subMask = (~0 << (32 - newPrefix)) >>> 0
  const subMaskStr = intToIp(subMask)

  const list = []
  for (let i = 0; i < safeCount; i++) {
    const subNetInt = (baseNet + i * subSize) >>> 0
    const subBcastInt = (subNetInt + subSize - 1) >>> 0
    let fHost = ''
    let lHost = ''
    let usable = 0

    if (newPrefix === 32) {
      fHost = intToIp(subNetInt)
      lHost = intToIp(subNetInt)
      usable = 1
    } else if (newPrefix === 31) {
      fHost = intToIp(subNetInt)
      lHost = intToIp(subBcastInt)
      usable = 2
    } else {
      fHost = intToIp(subNetInt + 1)
      lHost = intToIp(subBcastInt - 1)
      usable = Math.max(0, subSize - 2)
    }

    list.push({
      index: i + 1,
      cidr: `${intToIp(subNetInt)}/${newPrefix}`,
      network: intToIp(subNetInt),
      broadcast: intToIp(subBcastInt),
      netmask: subMaskStr,
      firstUsable: fHost,
      lastUsable: lHost,
      usableHosts: usable,
      totalAddresses: subSize,
    })
  }
  return list
}

export default function IpCalculator() {
  const [activeTab, setActiveTab] = useState('ipv4')
  const [ipv4Input, setIpv4Input] = useState('192.168.1.10')
  const [cidrPrefix, setCidrPrefix] = useState(24)
  const [copiedKey, setCopiedKey] = useState(null)
  const [splitPrefix, setSplitPrefix] = useState(26)

  const [ipv6Input, setIpv6Input] = useState('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
  const [ipv6Prefix, setIpv6Prefix] = useState(64)
  const [ipv6Result, setIpv6Result] = useState(null)
  const [ipv6Loading, setIpv6Loading] = useState(false)

  const ipv4Result = useMemo(() => {
    return calculateIpv4Local(ipv4Input, cidrPrefix)
  }, [ipv4Input, cidrPrefix])

  const subnetsList = useMemo(() => {
    if (!ipv4Result) return []
    return splitSubnetLocal(ipv4Result.network, cidrPrefix, splitPrefix)
  }, [ipv4Result, cidrPrefix, splitPrefix])

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1800)
  }

  const handleMaskChange = (mask) => {
    const maskInt = ipToInt(mask)
    if (maskInt !== null) {
      let p = 0
      for (let i = 31; i >= 0; i--) {
        if ((maskInt >>> i) & 1) p++
        else break
      }
      setCidrPrefix(p)
    }
  }

  const handleCalculateIpv6 = async () => {
    if (!ipv6Input.trim()) return
    setIpv6Loading(true)
    try {
      const res = await fetch('/api/tools/ip-calc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr: `${ipv6Input.trim()}/${ipv6Prefix}` })
      })
      if (res.ok) {
        const data = await res.json()
        setIpv6Result(data)
      } else {
        const err = await res.json()
        alert(`IPv6 calculation error: ${err.detail || 'Failed'}`)
      }
    } catch (e) {
      alert(`Network error: ${e.message}`)
    } finally {
      setIpv6Loading(false)
    }
  }

  return (
    <div className="tab-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">IP Subnet & VLSM Calculator</h1>
          <p className="page-subtitle">Interactive CIDR subnetting, binary bit breakdown, VLSM divider, and IPv6 analyzer</p>
        </div>
        <div className="status-badge complete">
          <span className="status-dot" />
          Realtime Engine
        </div>
      </div>

      <div className="subtabs-nav">
        <button
          className={`subtab-pill ${activeTab === 'ipv4' ? 'active' : ''}`}
          onClick={() => setActiveTab('ipv4')}
        >
          🧮 IPv4 Subnet Calculator
        </button>
        <button
          className={`subtab-pill ${activeTab === 'divider' ? 'active' : ''}`}
          onClick={() => setActiveTab('divider')}
        >
          ✂️ Subnet Divider / VLSM
        </button>
        <button
          className={`subtab-pill ${activeTab === 'ipv6' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('ipv6')
            if (!ipv6Result) handleCalculateIpv6()
          }}
        >
          🌐 IPv6 Calculator
        </button>
      </div>

      {activeTab === 'ipv4' && (
        <div className="ipcalc-v4-view">
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 className="card-title">⚙️ Subnet Parameters</h2>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">IP Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 192.168.1.10"
                  value={ipv4Input}
                  onChange={(e) => setIpv4Input(e.target.value)}
                  style={{ fontFamily: 'monospace', fontWeight: 600 }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Subnet Mask</label>
                <select
                  className="form-select"
                  value={ipv4Result?.netmask || '255.255.255.0'}
                  onChange={(e) => handleMaskChange(e.target.value)}
                  style={{ fontFamily: 'monospace' }}
                >
                  {Array.from({ length: 33 }, (_, i) => i).reverse().map(p => {
                    const mask = p === 0 ? '0.0.0.0' : intToIp((~0 << (32 - p)) >>> 0)
                    return (
                      <option key={p} value={mask}>
                        /{p} ({mask})
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Prefix Length</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="pill-badge" style={{ fontSize: 16, padding: '7px 16px', background: 'var(--cyan-dim)', color: 'var(--cyan)' }}>
                    /{cidrPrefix}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {ipv4Result ? `${ipv4Result.usableHosts.toLocaleString()} usable hosts` : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="form-label" style={{ marginBottom: 0 }}>Interactive CIDR Slider (/1 to /32)</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Slide to recalculate instantaneously</span>
              </div>
              <input
                type="range"
                className="cidr-slider"
                min="1"
                max="32"
                value={cidrPrefix}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setCidrPrefix(val)
                  if (splitPrefix <= val) {
                    setSplitPrefix(Math.min(32, val + 2))
                  }
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center', marginRight: 4 }}>
                Common Presets:
              </span>
              {IPV4_PRESETS.map(p => (
                <button
                  key={p.prefix}
                  className={`btn-preset-pill ${cidrPrefix === p.prefix ? 'active' : ''}`}
                  onClick={() => {
                    setCidrPrefix(p.prefix)
                    if (splitPrefix <= p.prefix) {
                      setSplitPrefix(Math.min(32, p.prefix + 2))
                    }
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {ipv4Result ? (
            <>
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h2 className="card-title" style={{ marginBottom: 0 }}>
                    🧬 32-Bit Binary Structure
                  </h2>
                  <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--cyan)' }}>
                      <span className="bit-dot bit-net-dot" /> Network Bits ({cidrPrefix})
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--green)' }}>
                      <span className="bit-dot bit-host-dot" /> Host Bits ({32 - cidrPrefix})
                    </span>
                  </div>
                </div>

                <div className="binary-octets-container">
                  {[0, 1, 2, 3].map(octetIndex => {
                    const octetBits = ipv4Result.binIp.slice(octetIndex * 8, octetIndex * 8 + 8).split('')
                    const octetVal = (ipv4Result.integer >>> ((3 - octetIndex) * 8)) & 255

                    return (
                      <div key={octetIndex} className="binary-octet-block">
                        <div className="binary-octet-header">
                          <span>Octet {octetIndex + 1}</span>
                          <strong>{octetVal}</strong>
                        </div>
                        <div className="binary-bits-row">
                          {octetBits.map((bit, bIdx) => {
                            const globalBitIdx = octetIndex * 8 + bIdx
                            const isNetBit = globalBitIdx < cidrPrefix
                            return (
                              <div
                                key={bIdx}
                                className={`bit-pill ${isNetBit ? 'bit-network' : 'bit-host'}`}
                                title={`Bit ${globalBitIdx + 1}: ${isNetBit ? 'Network' : 'Host'}`}
                              >
                                {bit}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="ipcalc-metric-grid">
                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">Network Address</span>
                    <button
                      className="btn-copy-mini"
                      onClick={() => handleCopy(`${ipv4Result.network}/${ipv4Result.cidr}`, 'net')}
                    >
                      {copiedKey === 'net' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="metric-value font-mono highlight-cyan">
                    {ipv4Result.network}
                    <span className="metric-sub">/{ipv4Result.cidr}</span>
                  </div>
                  <div className="metric-note">Subnet base identifier</div>
                </div>

                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">Broadcast Address</span>
                    <button
                      className="btn-copy-mini"
                      onClick={() => handleCopy(ipv4Result.broadcast, 'bcast')}
                    >
                      {copiedKey === 'bcast' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="metric-value font-mono highlight-pink">
                    {ipv4Result.broadcast}
                  </div>
                  <div className="metric-note">Subnet broadcast packet target</div>
                </div>

                <div className="metric-card span-2">
                  <div className="metric-card-top">
                    <span className="metric-title">Usable Host IP Range</span>
                    <button
                      className="btn-copy-mini"
                      onClick={() => handleCopy(`${ipv4Result.firstUsable} - ${ipv4Result.lastUsable}`, 'range')}
                    >
                      {copiedKey === 'range' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="metric-value font-mono highlight-green" style={{ fontSize: 16 }}>
                    {ipv4Result.firstUsable} <span style={{ color: 'var(--text-muted)' }}>➔</span> {ipv4Result.lastUsable}
                  </div>
                  <div className="metric-note">
                    {ipv4Result.usableHosts.toLocaleString()} assignable hosts ({ipv4Result.totalAddresses.toLocaleString()} total addresses)
                  </div>
                </div>

                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">Subnet Mask</span>
                    <button
                      className="btn-copy-mini"
                      onClick={() => handleCopy(ipv4Result.netmask, 'mask')}
                    >
                      {copiedKey === 'mask' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="metric-value font-mono">
                    {ipv4Result.netmask}
                  </div>
                  <div className="metric-note">Standard decimal notation</div>
                </div>

                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">Wildcard Mask</span>
                    <button
                      className="btn-copy-mini"
                      onClick={() => handleCopy(ipv4Result.wildcard, 'wild')}
                    >
                      {copiedKey === 'wild' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                  <div className="metric-value font-mono highlight-amber">
                    {ipv4Result.wildcard}
                  </div>
                  <div className="metric-note">Inverted mask for Cisco ACL & OSPF</div>
                </div>

                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">IP Class & Scope</span>
                  </div>
                  <div className="metric-value" style={{ fontSize: 15 }}>
                    {ipv4Result.ipClass}
                  </div>
                  <div className="metric-note" style={{ color: 'var(--cyan)' }}>
                    {ipv4Result.scope}
                  </div>
                </div>

                <div className="metric-card">
                  <div className="metric-card-top">
                    <span className="metric-title">Hex & Integer Representation</span>
                  </div>
                  <div className="metric-value font-mono" style={{ fontSize: 14 }}>
                    {ipv4Result.hex}
                  </div>
                  <div className="metric-note font-mono">
                    Dec: {ipv4Result.integer}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="card">
              <div className="empty-state">
                ⚠️ Invalid IPv4 address format. Please enter a valid address (e.g. 192.168.1.1).
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'divider' && (
        <div className="ipcalc-divider-view">
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 className="card-title">✂️ Subnet Splitting & VLSM Planner</h2>
            <p className="page-desc" style={{ marginBottom: 16 }}>
              Divide current network <strong>{ipv4Result?.network}/{cidrPrefix}</strong> into smaller subnets.
            </p>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">Parent Network</label>
                <input
                  type="text"
                  className="form-input"
                  value={`${ipv4Result?.network || '192.168.1.0'}/${cidrPrefix}`}
                  disabled
                  style={{ fontFamily: 'monospace', fontWeight: 600 }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Target Subnet Size (Prefix)</label>
                <select
                  className="form-select"
                  value={splitPrefix}
                  onChange={(e) => setSplitPrefix(Number(e.target.value))}
                >
                  {Array.from({ length: 32 - cidrPrefix }, (_, idx) => cidrPrefix + 1 + idx).map(p => {
                    const subnetsCount = Math.pow(2, p - cidrPrefix)
                    const hostsPerSub = p === 32 ? 1 : p === 31 ? 2 : Math.max(0, Math.pow(2, 32 - p) - 2)
                    return (
                      <option key={p} value={p}>
                        /{p} ({subnetsCount.toLocaleString()} subnets • {hostsPerSub.toLocaleString()} hosts each)
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Generated Count</label>
                <div style={{ display: 'flex', alignItems: 'center', height: 40 }}>
                  <span className="pill-badge pill-latency" style={{ fontSize: 13, padding: '6px 14px' }}>
                    ⚡ {Math.pow(2, splitPrefix - cidrPrefix).toLocaleString()} Subnets
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 className="card-title" style={{ marginBottom: 0 }}>
                📋 Generated Subnets Table
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Showing {subnetsList.length} subnets
              </span>
            </div>

            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>#</th>
                    <th>Subnet CIDR</th>
                    <th>Netmask</th>
                    <th>Usable Host Range</th>
                    <th>Broadcast</th>
                    <th>Usable</th>
                    <th style={{ width: 90, textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {subnetsList.map((sub) => (
                    <tr key={sub.index}>
                      <td style={{ color: 'var(--text-muted)' }}>#{sub.index}</td>
                      <td>
                        <strong className="highlight-cyan" style={{ fontFamily: 'monospace' }}>
                          {sub.cidr}
                        </strong>
                      </td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {sub.netmask}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--green)' }}>
                        {sub.firstUsable} <span style={{ color: 'var(--text-muted)' }}>➔</span> {sub.lastUsable}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {sub.broadcast}
                      </td>
                      <td>
                        <span className="pill-badge" style={{ background: 'rgba(0, 232, 135, 0.1)', color: 'var(--green)' }}>
                          {sub.usableHosts}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn-copy-mini"
                          onClick={() => handleCopy(sub.cidr, `sub-${sub.index}`)}
                        >
                          {copiedKey === `sub-${sub.index}` ? '✓' : '📋 Copy'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ipv6' && (
        <div className="ipcalc-v6-view">
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 className="card-title">🌐 IPv6 Address & Prefix Configuration</h2>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">IPv6 Address</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 2001:db8:85a3::8a2e:370:7334"
                  value={ipv6Input}
                  onChange={(e) => setIpv6Input(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCalculateIpv6()}
                  style={{ fontFamily: 'monospace', fontWeight: 600 }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Prefix Length</label>
                <select
                  className="form-select"
                  value={ipv6Prefix}
                  onChange={(e) => setIpv6Prefix(Number(e.target.value))}
                  style={{ fontFamily: 'monospace' }}
                >
                  {[128, 120, 112, 96, 64, 56, 48, 32, 16].map(p => (
                    <option key={p} value={p}>
                      /{p} {p === 64 ? '(Standard Subnet)' : p === 48 ? '(Site / Enterprise)' : p === 128 ? '(Single Host)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-success"
                  onClick={handleCalculateIpv6}
                  disabled={ipv6Loading || !ipv6Input.trim()}
                  style={{ minWidth: 160 }}
                >
                  {ipv6Loading ? '⏳ Calculating…' : '▶ Calculate IPv6'}
                </button>
              </div>
            </div>
          </div>

          {ipv6Result && (
            <div className="ipcalc-metric-grid">
              <div className="metric-card span-2">
                <div className="metric-card-top">
                  <span className="metric-title">Compressed (Standard Notation)</span>
                  <button
                    className="btn-copy-mini"
                    onClick={() => handleCopy(ipv6Result.compressed, 'v6-comp')}
                  >
                    {copiedKey === 'v6-comp' ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div className="metric-value font-mono highlight-cyan" style={{ fontSize: 16 }}>
                  {ipv6Result.compressed}
                </div>
                <div className="metric-note">RFC 5952 canonical recommendation</div>
              </div>

              <div className="metric-card span-2">
                <div className="metric-card-top">
                  <span className="metric-title">Expanded / Exploded (Full 32 Hex Digits)</span>
                  <button
                    className="btn-copy-mini"
                    onClick={() => handleCopy(ipv6Result.exploded, 'v6-exp')}
                  >
                    {copiedKey === 'v6-exp' ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div className="metric-value font-mono" style={{ fontSize: 14, wordBreak: 'break-all' }}>
                  {ipv6Result.exploded}
                </div>
                <div className="metric-note">All 8 blocks fully zero-padded</div>
              </div>

              <div className="metric-card">
                <div className="metric-card-top">
                  <span className="metric-title">Network Prefix</span>
                  <button
                    className="btn-copy-mini"
                    onClick={() => handleCopy(ipv6Result.cidr_notation, 'v6-net')}
                  >
                    {copiedKey === 'v6-net' ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
                <div className="metric-value font-mono highlight-green" style={{ fontSize: 15 }}>
                  {ipv6Result.network_address}/{ipv6Result.cidr_prefix}
                </div>
                <div className="metric-note">Subnet prefix identifier</div>
              </div>

              <div className="metric-card">
                <div className="metric-card-top">
                  <span className="metric-title">Scope & Classification</span>
                </div>
                <div className="metric-value" style={{ fontSize: 15 }}>
                  {ipv6Result.scope}
                </div>
                <div className="metric-note" style={{ color: 'var(--cyan)' }}>
                  IPv6 Address Type
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-card-top">
                  <span className="metric-title">/64 Subnets in Prefix</span>
                </div>
                <div className="metric-value font-mono highlight-amber" style={{ fontSize: 16 }}>
                  {ipv6Result.subnets_64}
                </div>
                <div className="metric-note">Available standard subnets</div>
              </div>

              <div className="metric-card">
                <div className="metric-card-top">
                  <span className="metric-title">Total Address Space</span>
                </div>
                <div className="metric-value font-mono" style={{ fontSize: 13, wordBreak: 'break-all' }}>
                  2^{128 - ipv6Result.cidr_prefix} addresses
                </div>
                <div className="metric-note">
                  {ipv6Result.total_addresses}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
