import { useState, useEffect, useRef } from 'react'

const PROFILES = [
  { name: 'Quick scan', cmd: 'nmap -T4 -F' },
  { name: 'Quick scan plus', cmd: 'nmap -sV -T4 -O -F --version-light' },
  { name: 'Intense scan', cmd: 'nmap -T4 -A -v' },
  { name: 'Intense scan plus UDP', cmd: 'nmap -sS -sU -T4 -A -v' },
  { name: 'Intense scan, all TCP ports', cmd: 'nmap -p 1-65535 -T4 -A -v' },
  { name: 'Intense scan, no ping', cmd: 'nmap -T4 -A -v -Pn' },
  { name: 'Ping scan', cmd: 'nmap -sn' },
  { name: 'Quick traceroute', cmd: 'nmap -sn --traceroute' },
  { name: 'Regular scan', cmd: 'nmap' },
  { name: 'Slow comprehensive scan', cmd: 'nmap -sS -sU -T4 -A -v -PE -PP -PS80,443 -PA3389 -PU40125 -PY -g 53 --script "default or (discovery and safe)"' },
  { name: 'Vulnerability scan', cmd: 'nmap -sV --script vuln' },
  { name: 'SSL/TLS Ciphers & Cert', cmd: 'nmap -sV --script ssl-cert,ssl-enum-ciphers -p 443' },
  { name: 'Service Banner Grab', cmd: 'nmap -sV --script banner' },
  { name: 'Safe Discovery Audit', cmd: 'nmap -sV --script "default and safe"' },
  { name: 'HTTP Security Headers', cmd: 'nmap -p 80,443 --script http-security-headers,http-methods' },
]

export default function NmapScanner() {
  const [target, setTarget] = useState('127.0.0.1')
  const [selectedProfile, setSelectedProfile] = useState('Quick scan')
  const [command, setCommand] = useState('nmap -T4 -F 127.0.0.1')
  const [activeTab, setActiveTab] = useState('output') // 'output' | 'ports' | 'details'
  
  const [scanning, setScanning] = useState(false)
  const [scanId, setScanId] = useState(null)
  const [outputLines, setOutputLines] = useState([])
  const [ports, setPorts] = useState([])
  const [hostDetails, setHostDetails] = useState(null)
  const [scanStatus, setScanStatus] = useState('idle') // 'idle' | 'running' | 'complete' | 'stopped' | 'error'
  
  const wsRef = useRef(null)
  const terminalBottomRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Update command when profile or target changes
  const handleProfileChange = (profileName) => {
    setSelectedProfile(profileName)
    const found = PROFILES.find(p => p.name === profileName)
    if (found) {
      setCommand(`${found.cmd} ${target.trim()}`)
    }
  }

  const handleTargetChange = (val) => {
    setTarget(val)
    const found = PROFILES.find(p => p.name === selectedProfile)
    const base = found ? found.cmd : 'nmap -T4 -F'
    setCommand(`${base} ${val.trim()}`)
  }

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [outputLines, autoScroll])

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  const startScan = async () => {
    if (!target.trim() || scanning) return
    setScanning(true)
    setScanStatus('running')
    setOutputLines([`Starting Nmap scan: ${command}...`])
    setPorts([])
    setHostDetails(null)

    try {
      const res = await fetch('/api/nmap/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: target.trim(),
          profile: selectedProfile,
          command_override: command.trim()
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Scan launch failed')
      }

      const data = await res.json()
      setScanId(data.scan_id)

      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws/nmap/${data.scan_id}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'line') {
            setOutputLines(prev => [...prev, msg.line])
          } else if (msg.type === 'port_found') {
            setPorts(prev => {
              if (prev.some(p => p.port === msg.port.port)) return prev
              return [...prev, msg.port]
            })
          } else if (msg.type === 'complete') {
            setScanning(false)
            setScanStatus('complete')
            if (msg.ports) setPorts(msg.ports)
            if (msg.host_details) setHostDetails(msg.host_details)
            setOutputLines(prev => [...prev, '\n[+] Scan finished successfully.'])
            ws.close()
          } else if (msg.type === 'stopped') {
            setScanning(false)
            setScanStatus('stopped')
            setOutputLines(prev => [...prev, '\n[!] Scan was stopped by user.'])
            ws.close()
          } else if (msg.type === 'error') {
            setScanning(false)
            setScanStatus('error')
            setOutputLines(prev => [...prev, `\n[ERROR] ${msg.message}`])
            ws.close()
          }
        } catch (e) {
          // non-json line
        }
      }

      ws.onerror = () => {
        setScanning(false)
        setScanStatus('error')
      }
    } catch (err) {
      setScanning(false)
      setScanStatus('error')
      setOutputLines(prev => [...prev, `[ERROR] ${err.message}`])
    }
  }

  const stopScan = async () => {
    if (!scanId) return
    try {
      await fetch(`/api/nmap/stop/${scanId}`, { method: 'POST' })
    } catch (e) {}
  }

  return (
    <div className="tab-page">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Nmap Network Scanner</h1>
          <p className="page-subtitle">Comprehensive port scanning, service version discovery, and host OS detection (Zenmap Interface)</p>
        </div>
        <div className={`status-badge ${scanStatus}`}>
          <span className="status-dot" />
          {scanStatus === 'running' ? 'Scanning…' : scanStatus === 'complete' ? 'Complete' : scanStatus === 'stopped' ? 'Stopped' : 'Ready'}
        </div>
      </div>

      {/* ── Configuration Card ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="card-title">⚙️ Scanner Configuration</h2>

        <div className="form-grid-3">
          <div className="form-group">
            <label className="form-label">Target (Host / IP / CIDR)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. 192.168.1.1 or example.com"
              value={target}
              onChange={(e) => handleTargetChange(e.target.value)}
              disabled={scanning}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Scan Profile</label>
            <select
              className="form-select"
              value={selectedProfile}
              onChange={(e) => handleProfileChange(e.target.value)}
              disabled={scanning}
            >
              {PROFILES.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <label className="form-label" style={{ opacity: 0 }}>Action</label>
            {!scanning ? (
              <button className="btn btn-success" onClick={startScan} disabled={!target.trim()}>
                ▶ Start Scan
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopScan}>
                ■ Stop Scan
              </button>
            )}
          </div>
        </div>

        {/* Command Line Field */}
        <div className="form-group" style={{ marginTop: 8, marginBottom: 0 }}>
          <label className="form-label">Command Line (Editable)</label>
          <input
            type="text"
            className="form-input"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={scanning}
            spellCheck={false}
            style={{ fontFamily: 'monospace', color: 'var(--cyan)' }}
          />
        </div>
      </div>

      {/* ── Modern Sub Navigation ── */}
      <div className="subtabs-nav">
        <button
          className={`subtab-pill ${activeTab === 'output' ? 'active' : ''}`}
          onClick={() => setActiveTab('output')}
        >
          💻 Nmap Output
          {outputLines.length > 0 && <span className="tab-counter">{outputLines.length}</span>}
        </button>
        <button
          className={`subtab-pill ${activeTab === 'ports' ? 'active' : ''}`}
          onClick={() => setActiveTab('ports')}
        >
          🔌 Ports / Hosts
          {ports.length > 0 && <span className="tab-counter count-active">{ports.length}</span>}
        </button>
        <button
          className={`subtab-pill ${activeTab === 'details' ? 'active' : ''}`}
          onClick={() => setActiveTab('details')}
        >
          📋 Host Details
        </button>
      </div>

      {/* ── Output Content ── */}
      <div className="card nmap-results-card">

        {/* Tab 1: Terminal Output */}
        {activeTab === 'output' && (
          <div className="terminal-container">
            <div className="terminal-header">
              <span className="terminal-title">Console Output</span>
              <div className="terminal-tools">
                <label className="checkbox-label" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto-scroll
                </label>
                <button
                  className="btn-tiny"
                  onClick={() => navigator.clipboard.writeText(outputLines.join('\n'))}
                >
                  📋 Copy
                </button>
                <button
                  className="btn-tiny"
                  onClick={() => setOutputLines([])}
                >
                  🗑 Clear
                </button>
              </div>
            </div>
            <div className="terminal-body">
              {outputLines.length === 0 ? (
                <div className="terminal-placeholder">
                  Ready to scan. Select target and click 'Scan' to start nmap.
                </div>
              ) : (
                outputLines.map((line, idx) => (
                  <div key={idx} className="terminal-line">{line}</div>
                ))
              )}
              <div ref={terminalBottomRef} />
            </div>
          </div>
        )}

        {/* Tab 2: Ports / Hosts Table */}
        {activeTab === 'ports' && (
          <div className="table-responsive">
            {ports.length === 0 ? (
              <div className="empty-state">
                {scanning ? 'Discovering ports...' : 'No open ports detected yet.'}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Port</th>
                    <th>Protocol</th>
                    <th>State</th>
                    <th>Service</th>
                    <th>Version / Info</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p, i) => {
                    const [pNum, proto] = (p.port || '').split('/')
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600, color: 'var(--accent)' }}>{pNum}</td>
                        <td><span className="proto-pill">{proto || 'tcp'}</span></td>
                        <td>
                          <span className={`state-badge ${p.state}`}>
                            {p.state}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{p.service}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.version || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tab 3: Host Details */}
        {activeTab === 'details' && (
          <div className="host-details-grid">
            <div className="detail-card">
              <div className="detail-label">Host Status</div>
              <div className="detail-value" style={{ color: hostDetails?.state === 'Up' ? 'var(--green)' : 'var(--text)' }}>
                {hostDetails?.state || (ports.length > 0 ? 'Up' : 'Unknown')}
              </div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Latency</div>
              <div className="detail-value">{hostDetails?.latency || '-'}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Open Ports</div>
              <div className="detail-value" style={{ color: 'var(--green)' }}>{hostDetails?.open_ports || ports.filter(p => p.state === 'open').length}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Filtered Ports</div>
              <div className="detail-value" style={{ color: 'var(--amber)' }}>{hostDetails?.filtered_ports || ports.filter(p => p.state === 'filtered').length}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">Closed Ports</div>
              <div className="detail-value">{hostDetails?.closed_ports || ports.filter(p => p.state === 'closed').length}</div>
            </div>
            <div className="detail-card">
              <div className="detail-label">MAC Address</div>
              <div className="detail-value">{hostDetails?.mac || '-'}</div>
            </div>
            <div className="detail-card full-width">
              <div className="detail-label">MAC Vendor / Manufacturer</div>
              <div className="detail-value">{hostDetails?.vendor || '-'}</div>
            </div>
            <div className="detail-card full-width">
              <div className="detail-label">OS / Device Fingerprint</div>
              <div className="detail-value">{hostDetails?.os || 'Not detected or OS detection flag (-O) not specified'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
