import { useState, useEffect } from 'react'
import ServerMode from './components/ServerMode'
import ClientMode from './components/ClientMode'
import TestHistory from './components/TestHistory'

const TABS = [
  { id: 'client',  label: 'Client Mode',  icon: '⚡' },
  { id: 'server',  label: 'Server Mode',  icon: '🖥️', hasDot: true },
  { id: 'history', label: 'Test History', icon: '📊' },
]

export default function App() {
  const [activeTab, setActiveTab]     = useState('client')
  const [serverStatus, setServerStatus] = useState('stopped')
  const [historyKey, setHistoryKey]   = useState(0)

  // Poll server status so sidebar dot stays in sync even when not on the server tab
  useEffect(() => {
    const check = () =>
      fetch('/api/server/status')
        .then(r => r.json())
        .then(d => setServerStatus(d.status))
        .catch(() => {})
    check()
    const id = setInterval(check, 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="app-layout">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon-wrap">⚡</div>
          <div>
            <div className="logo-title">iPerf3 GUI</div>
            <div className="logo-sub">Network Tester</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-label">Modes</div>
          {TABS.map(tab => (
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
          <span>v1.0.0</span>
          <span>iPerf3</span>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        <div className="content-inner">
          {activeTab === 'client' && (
            <ClientMode onComplete={() => setHistoryKey(k => k + 1)} />
          )}
          {activeTab === 'server' && (
            <ServerMode onStatusChange={setServerStatus} />
          )}
          {activeTab === 'history' && (
            <TestHistory key={historyKey} />
          )}
        </div>
      </main>
    </div>
  )
}
