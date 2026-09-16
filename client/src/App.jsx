import { useState, useEffect } from 'react'
import ServerMode from './components/ServerMode'
import ClientMode from './components/ClientMode'
import TestHistory from './components/TestHistory'
import TraceRoute from './components/TraceRoute'
import RemoteAccess from './components/RemoteAccess'

export default function App() {
  const [appMode, setAppMode] = useState('full') // 'full' | 'portable'
  const [remotePort, setRemotePort] = useState(8088)
  const [activeTab, setActiveTab] = useState('client')
  const [serverStatus, setServerStatus] = useState('stopped')
  const [historyKey, setHistoryKey] = useState(0)
  const [traceHost, setTraceHost] = useState('')

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
        { id: 'client',  label: 'Client Mode',  icon: '⚡' },
        { id: 'trace',   label: 'Route Trace',  icon: '📍' },
        { id: 'server',  label: 'Server Mode',  icon: '🖥️', hasDot: true },
        { id: 'history', label: 'Test History', icon: '📊' },
        { id: 'remote',  label: 'Remote Access', icon: '🛡️' },
      ]

  const handleStartTraceFromClient = (host) => {
    setTraceHost(host)
    setActiveTab('trace')
  }

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
      <main className="main-content">
        <div className="content-inner">
          {activeTab === 'client' && (
            <ClientMode
              onComplete={() => setHistoryKey(k => k + 1)}
              onRunTrace={!isPortable ? handleStartTraceFromClient : null}
            />
          )}
          {!isPortable && activeTab === 'trace' && (
            <TraceRoute initialHost={traceHost} />
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
