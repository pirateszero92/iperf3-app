import { useState, useEffect, useRef } from 'react'

export default function TrafficAnalyzer() {
  const [activeSubTab, setActiveSubTab] = useState('monitor') // 'monitor' | 'performance' | 'capture'

  // WebSocket & Telemetry State
  const [wsConnected, setWsConnected] = useState(false)
  const [metricsHistory, setMetricsHistory] = useState([])
  const [currentMetrics, setCurrentMetrics] = useState({
    pps: 0,
    kbps: 0,
    mbps: 0,
    broadcast: 0,
    multicast: 0,
    unicast: 0,
    top_talkers: [],
    avg_rtt_ms: 0,
    tcp_retransmissions: 0,
  })
  const [alerts, setAlerts] = useState([])
  const [internalSniffing, setInternalSniffing] = useState(false)
  const [internalLoading, setInternalLoading] = useState(false)

  // Packet Capture State
  const [interfaces, setInterfaces] = useState([])
  const [selectedIface, setSelectedIface] = useState('eth0')
  const [bpfFilter, setBpfFilter] = useState('')
  const [captureDuration, setCaptureDuration] = useState(30)
  const [maxPackets, setMaxPackets] = useState(2000)
  const [captureStatus, setCaptureStatus] = useState({ active: false })
  const [captureHistory, setCaptureHistory] = useState([])
  const [captureLoading, setCaptureLoading] = useState(false)
  const [showHostGuide, setShowHostGuide] = useState(false)

  const wsRef = useRef(null)

  // Connect WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/traffic`

    function connect() {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
      }

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'init') {
            if (msg.alerts) setAlerts(msg.alerts)
          } else if (msg.type === 'metrics' && msg.data) {
            setCurrentMetrics(msg.data)
            setMetricsHistory((prev) => [...prev.slice(-29), msg.data])
          } else if (msg.type === 'new_alert' && msg.alert) {
            setAlerts((prev) => [msg.alert, ...prev.slice(0, 99)])
          }
        } catch (e) {}
      }

      ws.onclose = () => {
        setWsConnected(false)
        setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // Poll Capture Status & Internal Sniff status
  useEffect(() => {
    fetchInterfaces()
    fetchCaptureStatus()
    fetchCaptureHistory()
    checkInternalSniffStatus()

    const interval = setInterval(() => {
      fetchCaptureStatus()
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const fetchInterfaces = async () => {
    try {
      const res = await fetch('/api/capture/interfaces')
      if (res.ok) {
        const data = await res.json()
        setInterfaces(data)
        if (data.length > 0 && !data.some(i => i.name === selectedIface)) {
          setSelectedIface(data[0].name)
        }
      }
    } catch (e) {}
  }

  const fetchCaptureStatus = async () => {
    try {
      const res = await fetch('/api/capture/status')
      if (res.ok) {
        const data = await res.json()
        setCaptureStatus(data)
      }
    } catch (e) {}
  }

  const fetchCaptureHistory = async () => {
    try {
      const res = await fetch('/api/capture/history')
      if (res.ok) {
        const data = await res.json()
        setCaptureHistory(data)
      }
    } catch (e) {}
  }

  const checkInternalSniffStatus = async () => {
    try {
      const res = await fetch('/api/traffic/internal-sniff/status')
      if (res.ok) {
        const data = await res.json()
        setInternalSniffing(data.active)
      }
    } catch (e) {}
  }

  const handleToggleInternalSniff = async () => {
    setInternalLoading(true)
    try {
      const res = await fetch('/api/traffic/internal-sniff/toggle', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setInternalSniffing(data.active)
      }
    } catch (e) {
      alert(`Error toggling sniffer: ${e.message}`)
    } finally {
      setInternalLoading(false)
    }
  }

  const handleStartCapture = async () => {
    setCaptureLoading(true)
    try {
      const res = await fetch('/api/capture/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interface: selectedIface,
          filter: bpfFilter.trim(),
          duration: parseInt(captureDuration, 10) || 30,
          max_packets: parseInt(maxPackets, 10) || 2000,
        }),
      })
      if (res.ok) {
        fetchCaptureStatus()
      } else {
        const err = await res.json()
        alert(`Start capture failed: ${err.detail || 'Error'}`)
      }
    } catch (e) {
      alert(`Network error: ${e.message}`)
    } finally {
      setCaptureLoading(false)
    }
  }

  const handleStopCapture = async () => {
    setCaptureLoading(true)
    try {
      const res = await fetch('/api/capture/stop', { method: 'POST' })
      if (res.ok) {
        fetchCaptureStatus()
        setTimeout(fetchCaptureHistory, 1000)
      }
    } catch (e) {}
    finally {
      setCaptureLoading(false)
    }
  }

  const handleDeleteCapture = async (filename) => {
    if (!confirm(`Delete ${filename}?`)) return
    try {
      const res = await fetch(`/api/capture/${filename}`, { method: 'DELETE' })
      if (res.ok) {
        fetchCaptureHistory()
      }
    } catch (e) {}
  }

  const handleClearAlerts = async () => {
    try {
      const res = await fetch('/api/traffic/alerts/clear', { method: 'POST' })
      if (res.ok) {
        setAlerts([])
      }
    } catch (e) {}
  }

  const FILTER_PRESETS = [
    { label: 'All Traffic', value: '' },
    { label: 'iPerf3 (port 5201)', value: 'port 5201' },
    { label: 'ICMP / Ping', value: 'icmp' },
    { label: 'DNS (port 53)', value: 'port 53' },
    { label: 'Web (80 / 443)', value: 'port 80 or port 443' },
    { label: 'Exclude SSH', value: 'not port 22' },
  ]

  return (
    <div className="tab-panel">
      {/* ── Header ── */}
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="section-title">📡 Traffic & Packet Analyzer</div>
          <div className="section-desc">
            Real-time Loop & Storm detection, Top Talkers analysis, and Wireshark PCAP capture
          </div>
        </div>

        {/* Status Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--border)',
            padding: '4px 10px',
            borderRadius: 6
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: wsConnected ? '#10b981' : '#ef4444',
              boxShadow: wsConnected ? '0 0 8px #10b981' : 'none'
            }} />
            <span style={{ color: 'var(--text-muted)' }}>
              {wsConnected ? 'Telemetry Live' : 'Disconnected'}
            </span>
          </div>

          <button
            className={`btn btn-sm ${internalSniffing ? 'btn-danger' : 'btn-secondary'}`}
            onClick={handleToggleInternalSniff}
            disabled={internalLoading}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {internalSniffing ? (
              <>
                <span className="live-dot" />
                Stop Docker Sniffer
              </>
            ) : (
              '⚡ Start Docker Sniffer'
            )}
          </button>
        </div>
      </div>

      {/* ── Sub-navigation Tabs ── */}
      <div className="subtabs-bar" style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button
          className={`subtab-pill ${activeSubTab === 'monitor' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('monitor')}
        >
          🔄 Loop & Storm Monitor
        </button>
        <button
          className={`subtab-pill ${activeSubTab === 'performance' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('performance')}
        >
          📈 App Performance & Top Talkers
        </button>
        <button
          className={`subtab-pill ${activeSubTab === 'capture' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('capture')}
        >
          📥 Packet Capture & PCAP Export
          {captureStatus.active && <span className="live-dot" style={{ marginLeft: 6 }} />}
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: LOOP & STORM MONITOR                                             */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'monitor' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Real-time KPI Stats Bar */}
          <div className="stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Total Bandwidth</div>
              <div className="stat-value" style={{ color: 'var(--cyan)', fontSize: 20 }}>
                {currentMetrics.mbps > 0.05 ? `${currentMetrics.mbps} Mbps` : `${currentMetrics.kbps} Kbps`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Current throughput</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Packet Rate</div>
              <div className="stat-value" style={{ color: '#38bdf8', fontSize: 20 }}>
                {currentMetrics.pps} <span style={{ fontSize: 13 }}>PPS</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Packets per second</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Broadcast Packets</div>
              <div className="stat-value" style={{ color: currentMetrics.broadcast > 50 ? '#f59e0b' : 'inherit', fontSize: 20 }}>
                {currentMetrics.broadcast} <span style={{ fontSize: 13 }}>PPS</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>FF:FF:FF:FF:FF:FF</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Multicast Packets</div>
              <div className="stat-value" style={{ color: '#c084fc', fontSize: 20 }}>
                {currentMetrics.multicast} <span style={{ fontSize: 13 }}>PPS</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>224.0.0.0/4 & IPv6</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Unicast Packets</div>
              <div className="stat-value" style={{ color: '#10b981', fontSize: 20 }}>
                {currentMetrics.unicast} <span style={{ fontSize: 13 }}>PPS</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Point-to-point</div>
            </div>
          </div>

          {/* Real-time Traffic Graph (CSS Bars) */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📊 Real-Time Packet Activity (Last 30 Seconds)</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-updating via WebSocket</span>
            </div>

            <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', gap: 4, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              {metricsHistory.map((m, idx) => {
                const maxVal = Math.max(...metricsHistory.map(x => x.pps), 20)
                const heightPct = Math.min(100, Math.max(8, (m.pps / maxVal) * 100))
                const bcastPct = m.pps > 0 ? (m.broadcast / m.pps) * 100 : 0
                return (
                  <div
                    key={idx}
                    style={{
                      flex: 1,
                      height: `${heightPct}%`,
                      background: bcastPct > 50 ? '#f59e0b' : 'var(--cyan)',
                      borderRadius: '2px 2px 0 0',
                      transition: 'height 0.3s ease',
                      position: 'relative',
                    }}
                    title={`${m.pps} PPS (Bcast: ${m.broadcast}, Mcast: ${m.multicast}) at ${new Date(m.timestamp).toLocaleTimeString()}`}
                  />
                )
              })}
              {metricsHistory.length === 0 && (
                <div style={{ width: '100%', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }}>
                  Awaiting traffic stream... (Click 'Start Docker Sniffer' or stream from Host)
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, background: 'var(--cyan)', borderRadius: 2 }} />
                <span>Normal Traffic (Unicast/Multicast)</span>
              </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, background: '#f59e0b', borderRadius: 2 }} />
                  <span>High Broadcast Traffic (&gt;50%)</span>
                </div>
            </div>
          </div>

          {/* Active Loop & Storm Alerts Table */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🚨</span> Real-Time Security & Loop Alerts
                <span className="badge" style={{ fontSize: 11 }}>{alerts.length} Total</span>
              </div>
              {alerts.length > 0 && (
                <button className="btn-tiny" onClick={handleClearAlerts}>
                  Clear Alerts
                </button>
              )}
            </div>

            {alerts.length > 0 ? (
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px', width: 90 }}>Severity</th>
                      <th style={{ padding: '8px 12px', width: 160 }}>Type</th>
                      <th style={{ padding: '8px 12px', width: 140 }}>Source Device</th>
                      <th style={{ padding: '8px 12px' }}>Event Message / Details</th>
                      <th style={{ padding: '8px 12px', width: 110 }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((al, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <span className={`status-badge ${al.severity === 'critical' ? 'red' : 'amber'}`} style={{ fontSize: 10 }}>
                            {al.severity}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{al.type}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--cyan)' }}>
                          {al.source}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{al.message}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                          {new Date(al.timestamp).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '24px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                ✓ No network loop or broadcast storm detected. Traffic is healthy.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: APP PERFORMANCE & TOP TALKERS                                    */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'performance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Performance KPIs */}
          <div className="stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Average RTT Latency</div>
              <div className="stat-value" style={{ color: 'var(--cyan)', fontSize: 22 }}>
                {currentMetrics.avg_rtt_ms} <span style={{ fontSize: 13 }}>ms</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>TCP Round-trip time</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">TCP Retransmissions</div>
              <div className="stat-value" style={{ color: currentMetrics.tcp_retransmissions > 0 ? '#f59e0b' : '#10b981', fontSize: 22 }}>
                {currentMetrics.tcp_retransmissions}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Packets retransmitted</div>
            </div>

            <div className="stat-box" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
              <div className="stat-label">Ingestion Inflow</div>
              <div className="stat-value" style={{ color: '#a78bfa', fontSize: 22 }}>
                {currentMetrics.pps} <span style={{ fontSize: 13 }}>PPS</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Active packet sampling</div>
            </div>
          </div>

          {/* Top Talkers Bar Table */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
              🔥 Top Talkers (Highest Transmitting IP Addresses)
            </div>

            {currentMetrics.top_talkers && currentMetrics.top_talkers.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {currentMetrics.top_talkers.map((talker, idx) => {
                  const maxBytes = Math.max(...currentMetrics.top_talkers.map(t => t.bytes), 1)
                  const pct = Math.round((talker.bytes / maxBytes) * 100)
                  return (
                    <div key={idx} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--cyan)' }}>
                          {talker.ip}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {talker.mb > 0.05 ? `${talker.mb} MB` : `${Math.round(talker.bytes / 1024)} KB`}
                        </span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--cyan)', borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No talkers recorded in current window. Start internal sniffer or stream host packets.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: PACKET CAPTURE & PCAP EXPORT                                      */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeSubTab === 'capture' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Capture Controls Card */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>🎯</span> On-Demand Packet Capture (tcpdump)
              </div>
              <button
                className="btn-tiny"
                onClick={() => setShowHostGuide(!showHostGuide)}
              >
                {showHostGuide ? 'Hide Host Stream Guide' : '📡 How to stream from Windows Host?'}
              </button>
            </div>

            {/* Host Stream Guide (Accordion) */}
            {showHostGuide && (
              <div style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.6
              }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  📡 How to stream physical Windows Host traffic into Docker (Port 9999):
                </div>
                <div>Run this command in PowerShell on your Windows Host (with Administrator privileges):</div>
                <pre style={{
                  background: 'rgba(0,0,0,0.5)',
                  padding: '10px 12px',
                  borderRadius: 6,
                  color: 'var(--cyan)',
                  margin: '8px 0',
                  overflowX: 'auto',
                  fontFamily: 'monospace'
                }}>
                  tshark -i 1 -T ek -e frame.time_epoch -e frame.len -e eth.src -e eth.dst -e ip.src -e ip.dst -e ip.id -e ip.proto -e tcp.srcport -e tcp.dstport -e tcp.seq | nc 127.0.0.1 9999
                </pre>
                <div>Or run the included <code>stream.ps1</code> script from the repository. Docker will automatically receive and process the stream!</div>
              </div>
            )}

            {/* Form Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <label className="form-label">Capture Interface</label>
                <select
                  className="select"
                  value={selectedIface}
                  onChange={e => setSelectedIface(e.target.value)}
                  disabled={captureStatus.active}
                >
                  {interfaces.map(i => (
                    <option key={i.name} value={i.name}>
                      {i.name} ({i.status})
                    </option>
                  ))}
                  {interfaces.length === 0 && <option value="eth0">eth0</option>}
                </select>
              </div>

              <div>
                <label className="form-label">Duration Limit (Seconds)</label>
                <input
                  type="number"
                  className="input"
                  value={captureDuration}
                  onChange={e => setCaptureDuration(e.target.value)}
                  disabled={captureStatus.active}
                  min={5}
                  max={300}
                />
              </div>

              <div>
                <label className="form-label">Max Packets</label>
                <input
                  type="number"
                  className="input"
                  value={maxPackets}
                  onChange={e => setMaxPackets(e.target.value)}
                  disabled={captureStatus.active}
                  min={10}
                  max={50000}
                />
              </div>
            </div>

            {/* BPF Filter */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>BPF Packet Filter (Optional)</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {FILTER_PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      className="btn-tiny"
                      style={{ fontSize: 11 }}
                      disabled={captureStatus.active}
                      onClick={() => setBpfFilter(p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="text"
                className="input"
                placeholder="e.g. port 5201 or icmp or host 10.1.1.1"
                value={bpfFilter}
                onChange={e => setBpfFilter(e.target.value)}
                disabled={captureStatus.active}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                {captureStatus.active ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="live-dot" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
                      Recording on {captureStatus.interface} ({captureStatus.duration}s timer)
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      File: {captureStatus.filename} ({Math.round(captureStatus.file_size / 1024)} KB)
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Captures packets and generates a standard .pcap file readable by Wireshark.
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {captureStatus.active ? (
                  <button
                    className="btn btn-danger"
                    onClick={handleStopCapture}
                    disabled={captureLoading}
                  >
                    ⏹️ Stop Capture
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleStartCapture}
                    disabled={captureLoading}
                  >
                    🔴 Start Capture
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Captured PCAP Files History */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📁</span> PCAP Files Archive ({captureHistory.length})
              </div>
              <button className="btn-tiny" onClick={fetchCaptureHistory}>
                Refresh List
              </button>
            </div>

            {captureHistory.length > 0 ? (
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '8px 12px' }}>Capture File (.pcap)</th>
                      <th style={{ padding: '8px 12px', width: 120 }}>File Size</th>
                      <th style={{ padding: '8px 12px', width: 180 }}>Recorded Date</th>
                      <th style={{ padding: '8px 12px', width: 170, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {captureHistory.map((cap) => (
                      <tr key={cap.filename} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: 'var(--cyan)' }}>
                          {cap.filename}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                          {cap.size_bytes > 1_000_000
                            ? `${(cap.size_bytes / 1_000_000).toFixed(2)} MB`
                            : `${Math.round(cap.size_bytes / 1024)} KB`}
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                          {new Date(cap.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <a
                            href={`/api/capture/download/${cap.filename}`}
                            download={cap.filename}
                            className="btn-tiny"
                            style={{ background: 'var(--primary)', color: 'white', textDecoration: 'none', marginRight: 6 }}
                          >
                            📥 Download .pcap
                          </a>
                          <button
                            className="btn-tiny"
                            style={{ color: '#ef4444' }}
                            onClick={() => handleDeleteCapture(cap.filename)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 13 }}>
                No PCAP captures generated yet. Start a capture above to create Wireshark dumps.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
