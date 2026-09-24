import { useState, useEffect } from 'react'
import ServerMode from './components/ServerMode'
import ClientMode from './components/ClientMode'
import TestHistory from './components/TestHistory'
import TraceRoute from './components/TraceRoute'
import RemoteAccess from './components/RemoteAccess'
import NmapScanner from './components/NmapScanner'
import IpManagement from './components/IpManagement'
import DnsWhois from './components/DnsWhois'
import IpCalculator from './components/IpCalculator'
import TrafficAnalyzer from './components/TrafficAnalyzer'
import SslAnalyzer from './components/SslAnalyzer'
import OpenSpeedTest from './components/OpenSpeedTest'
import NetworkMap from './components/NetworkMap'

export default function App() {
  const [appMode, setAppMode] = useState('full') // 'full' | 'portable'
  const [remotePort, setRemotePort] = useState(8088)
  const [speedtestPort, setSpeedtestPort] = useState(3002)
  const [hostIp, setHostIp] = useState('')
  const [hostIps, setHostIps] = useState([])
  const [activeTab, setActiveTab] = useState('client')
  const [serverStatus, setServerStatus] = useState('stopped')
  const [historyKey, setHistoryKey] = useState(0)
  const [clientHost, setClientHost] = useState('')
  const [traceHost, setTraceHost] = useState('')
  const [nmapHost, setNmapHost] = useState('')
  const [sslHost, setSslHost] = useState('')
  const [dnsHost, setDnsHost] = useState('')

  // Detect mode from backend API
  useEffect(() => {
    fetch('/api/mode')
      .then(r => r.json())
      .then(d => {
        if (d && d.mode) {
          setAppMode(d.mode)
        }
        if (d && d.remote_port) {
          setRemotePort(d.remote_port)
        }
        if (d && d.speedtest_port) {
          setSpeedtestPort(d.speedtest_port)
        }
        if (d && d.host_ip) {
          setHostIp(d.host_ip)
        }
        if (d && d.host_ips) {
          setHostIps(d.host_ips)
        }
      })
      .catch(() => {})
  }, [])

  // Poll server status (only relevant in full mode)
  useEffect(() => {
    if (appMode === 'portable') return
    const check = () =>
      fetch('/api/server/status')
        .then(r => r.json())
        .then(d => setServerStatus(d.status))
        .catch(() => {})
    check()
    const id = setInterval(check, 4000)
    return () => clearInterval(id)
  }, [appMode])

  const isPortable = appMode === 'portable'

  // Dynamic tabs based on mode
  const tabs = isPortable
    ? [
        { id: 'client',  label: 'Client Mode',  icon: '⚡' },
        { id: 'history', label: 'Test History', icon: '📊' },
      ]
    : [
        { id: 'client',    label: 'Client Mode',     icon: '⚡' },
        { id: 'speedtest', label: 'HTML5 SpeedTest', icon: '🚀' },
        { id: 'trace',     label: 'Route Trace',     icon: '📍' },
        { id: 'traffic',   label: 'Traffic & PCAP',  icon: '📡' },
        { id: 'map',       label: 'Network Map',     icon: '🗺️' },
        { id: 'nmap',      label: 'Nmap Scanner',    icon: '🔍' },
        { id: 'ssl',       label: 'SSL Analyzer',    icon: '🔐' },
        { id: 'ipam',      label: 'IP Management',   icon: '🌐' },
        { id: 'ipcalc',    label: 'IP Calculator',   icon: '🧮' },
        { id: 'dns',       label: 'DNS & WHOIS',     icon: '🔎' },
        { id: 'server',    label: 'Server Mode',     icon: '🖥️', hasDot: true },
        { id: 'history',   label: 'Test History',    icon: '📊' },
        { id: 'remote',    label: 'Remote Access',   icon: '🛡️' },
      ]

  const handleNavigate = (tab, host) => {
    if (tab === 'client') setClientHost(host)
    if (tab === 'trace') setTraceHost(host)
    if (tab === 'nmap') setNmapHost(host)
    if (tab === 'ssl') setSslHost(host)
    if (tab === 'dns') setDnsHost(host)
    setActiveTab(tab)
  }

  const handleStartTraceFromClient = (host) => {
    setTraceHost(host)
    setActiveTab('trace')
  }

  const isFullView = activeTab === 'remote' || activeTab === 'speedtest' || activeTab === 'map'

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon-wrap">{isPortable ? '⚡' : '🚀'}</div>
          <div>
            <div className="logo-title">{isPortable ? 'iPerf3 Client' : 'iPerf3 Hub'}</div>
            <div className="logo-sub">{isPortable ? 'Portable Client Tester' : 'Network & Remote Portal'}</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-label">{isPortable ? 'Tools' : 'Modes'}</div>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.hasDot && (
                <span className={`server-dot ${serverStatus}`} />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>v1.2.0</span>
          <span>{isPortable ? 'Client Only' : 'Full Stack'}</span>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={`main-content ${isFullView ? 'main-content-remote' : ''}`}>
        <div className={`content-inner ${isFullView ? 'content-inner-remote' : ''}`}>
          {activeTab === 'client' && (
            <ClientMode
              initialHost={clientHost}
              onComplete={() => setHistoryKey(k => k + 1)}
              onRunTrace={!isPortable ? handleStartTraceFromClient : null}
            />
          )}
          {!isPortable && activeTab === 'speedtest' && (
            <OpenSpeedTest
              speedtestPort={speedtestPort}
              hostIp={hostIp}
              hostIps={hostIps}
            />
          )}
          {!isPortable && activeTab === 'trace' && (
            <TraceRoute initialHost={traceHost} />
          )}
          {!isPortable && activeTab === 'traffic' && (
            <TrafficAnalyzer />
          )}
          {!isPortable && activeTab === 'map' && (
            <NetworkMap onNavigate={handleNavigate} />
          )}
          {!isPortable && activeTab === 'nmap' && (
            <NmapScanner initialHost={nmapHost} />
          )}
          {!isPortable && activeTab === 'ssl' && (
            <SslAnalyzer initialHost={sslHost} />
          )}
          {!isPortable && activeTab === 'ipam' && (
            <IpManagement />
          )}
          {!isPortable && activeTab === 'ipcalc' && (
            <IpCalculator />
          )}
          {!isPortable && activeTab === 'dns' && (
            <DnsWhois initialHost={dnsHost} />
          )}
          {!isPortable && activeTab === 'server' && (
            <ServerMode onStatusChange={setServerStatus} />
          )}
          {activeTab === 'history' && (
            <TestHistory key={historyKey} />
          )}
          {!isPortable && activeTab === 'remote' && (
            <RemoteAccess remotePort={remotePort} />
          )}
        </div>
      </main>
    </div>
  )
}
