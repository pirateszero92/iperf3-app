import { useState } from 'react'

export default function RemoteAccess({ remotePort = 8088 }) {
  const [iframeKey, setIframeKey] = useState(0)

  // Remote server URL
  const remoteUrl = `http://${window.location.hostname}:${remotePort}`

  const handleOpenNewWindow = () => {
    window.open(remoteUrl, '_blank', 'noopener,noreferrer')
  }

  const handleReload = () => {
    setIframeKey(k => k + 1)
  }

  return (
    <div className="remote-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* ── Top Header Bar ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-card)',
        padding: '12px 18px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontSize: 20,
            background: 'rgba(16,185,129,0.15)',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
          }}>
            🛡️
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              Remote Jump Server
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(16,185,129,0.2)',
                color: '#10b981',
                border: '1px solid rgba(16,185,129,0.4)',
              }}>
                SSH • RDP • VNC
              </span>
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Default credentials: <strong style={{ color: 'var(--cyan)' }}>admin</strong> / <strong style={{ color: 'var(--cyan)' }}>password</strong>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={handleReload}
            title="Reload remote view"
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleOpenNewWindow}
          >
            <span>↗ Open Fullscreen</span>
          </button>
        </div>
      </div>

      {/* ── Embedded Iframe ── */}
      <div style={{
        flex: 1,
        minHeight: 'calc(100vh - 160px)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: '#0a0f1d',
        position: 'relative',
      }}>
        <iframe
          key={iframeKey}
          src={remoteUrl}
          title="Jump Remote Access"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  )
}
