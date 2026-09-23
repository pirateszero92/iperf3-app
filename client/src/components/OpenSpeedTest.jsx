import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export default function OpenSpeedTest({ speedtestPort = 3002, hostIp = '', hostIps = [] }) {
  const [iframeKey, setIframeKey] = useState(0)
  const [showQrModal, setShowQrModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [customIp, setCustomIp] = useState('')
  const [isEditingIp, setIsEditingIp] = useState(false)

  // Current browser hostname
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const isLoopback = currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '::1'

  // Pick best default IP:
  // If user entered custom IP -> use that
  // Else if browser is already accessing via physical IP (not localhost) -> use currentHost
  // Else use hostIp discovered by backend (e.g. 172.16.0.5)
  // Else fallback to currentHost
  const activeIp = customIp.trim() || (!isLoopback && currentHost ? currentHost : (hostIp || currentHost))

  // Direct LAN URL for other devices (phones, tablets, laptops)
  const directUrl = `http://${activeIp}:${speedtestPort}`
  // Embedded URL through local reverse proxy
  const embeddedUrl = '/speedtest/'

  const handleCopyLink = () => {
    navigator.clipboard.writeText(directUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const handleOpenNewWindow = () => {
    window.open(embeddedUrl, '_blank', 'noopener,noreferrer')
  }

  const handleReload = () => {
    setIframeKey(k => k + 1)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      flex: 1,
      minHeight: 0,
      gap: 12,
    }}>
      {/* ── Top Header Bar ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-card)',
        padding: '12px 20px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        flexShrink: 0,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            fontSize: 22,
            background: 'rgba(6, 182, 212, 0.15)',
            color: 'var(--cyan)',
            width: 42,
            height: 42,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            border: '1px solid rgba(6, 182, 212, 0.3)',
            boxShadow: '0 0 12px rgba(6, 182, 212, 0.2)',
          }}>
            🚀
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              HTML5 SpeedTest
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(16,185,129,0.15)',
                color: '#10b981',
                border: '1px solid rgba(16,185,129,0.3)',
              }}>
                No Client App Needed
              </span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(6,182,212,0.15)',
                color: '#06b6d4',
                border: '1px solid rgba(6,182,212,0.3)',
              }}>
                OpenSpeedTest™ Engine
              </span>
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
              HTML5-based bandwidth assessment • Measures Download, Upload, Ping & Jitter across LAN / Wi-Fi
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              padding: '7px 14px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(6, 182, 212, 0.12)',
              borderColor: 'rgba(6, 182, 212, 0.3)',
              color: 'var(--cyan)'
            }}
            onClick={() => setShowQrModal(true)}
            title="Scan QR Code to test on Mobile / Other Devices"
          >
            📱 <span>Mobile QR & LAN Link</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '7px 12px', fontSize: 12 }}
            onClick={handleReload}
            title="Restart speed test interface"
          >
            🔄 <span>Reload</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '7px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleOpenNewWindow}
            title="Open in standalone tab"
          >
            <span>↗ Open Fullscreen</span>
          </button>
        </div>
      </div>

      {/* ── LAN Access Notice Strip ── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1527',
        border: '1px solid rgba(6, 182, 212, 0.25)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 16px',
        fontSize: 12,
        color: 'var(--text-secondary)',
        flexShrink: 0,
        gap: 8,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--cyan)', fontSize: 15 }}>📶</span>
              <span style={{ fontWeight: 500 }}>Test from Mobile / LAN:</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <code style={{
                background: 'rgba(0,0,0,0.5)',
                padding: '3px 10px',
                borderRadius: 6,
                color: 'var(--cyan)',
                fontFamily: 'monospace',
                fontSize: 13,
                fontWeight: 600,
                border: '1px solid rgba(6,182,212,0.3)',
                boxShadow: '0 0 10px rgba(6,182,212,0.15)',
              }}>
                {directUrl}
              </code>

              {hostIp && (
                <span style={{
                  fontSize: 11,
                  color: '#10b981',
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }} />
                  Host IP: <strong style={{ color: '#fff', marginLeft: 2 }}>{activeIp}</strong>
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn-tiny"
              onClick={() => setIsEditingIp(v => !v)}
              style={{
                cursor: 'pointer',
                color: isEditingIp ? 'var(--cyan)' : 'var(--text-secondary)',
                borderColor: isEditingIp ? 'var(--cyan)' : 'var(--border)'
              }}
              title="Select or enter different Host IP"
            >
              {isEditingIp ? '✕ Close' : '⚙️ Select / Custom IP'}
            </button>

            <button
              type="button"
              className="btn-tiny"
              onClick={handleCopyLink}
              style={{
                cursor: 'pointer',
                background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)',
                borderColor: copied ? '#10b981' : 'var(--border)',
                color: copied ? '#10b981' : 'var(--text-primary)',
              }}
            >
              {copied ? '✓ Copied!' : '📋 Copy URL'}
            </button>

            <button
              type="button"
              className="btn-tiny"
              onClick={() => setShowQrModal(true)}
              style={{
                cursor: 'pointer',
                color: '#fff',
                background: 'linear-gradient(135deg, rgba(6,182,212,0.3), rgba(16,185,129,0.3))',
                borderColor: 'rgba(6,182,212,0.5)',
                fontWeight: 600,
              }}
            >
              📱 View QR Code
            </button>
          </div>
        </div>

        {/* IP Selector / Custom Input Tray */}
        {isEditingIp && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(0,0,0,0.3)',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.08)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Detected IPs:</span>
            {hostIps && hostIps.length > 0 ? (
              hostIps.map(ip => (
                <button
                  key={ip}
                  type="button"
                  className="btn-tiny"
                  style={{
                    background: activeIp === ip ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.05)',
                    borderColor: activeIp === ip ? 'var(--cyan)' : 'var(--border)',
                    color: activeIp === ip ? 'var(--cyan)' : 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                  onClick={() => {
                    setCustomIp(ip)
                  }}
                >
                  {ip} {ip === hostIp ? '(Primary Host)' : ''}
                </button>
              ))
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No extra IPs found</span>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Manual IP:</span>
              <input
                type="text"
                className="form-input"
                style={{ width: 140, padding: '3px 8px', fontSize: 12 }}
                placeholder="e.g. 172.16.0.5"
                value={customIp}
                onChange={e => setCustomIp(e.target.value)}
              />
              {customIp && (
                <button
                  type="button"
                  className="btn-tiny"
                  onClick={() => setCustomIp('')}
                  style={{ cursor: 'pointer', fontSize: 10 }}
                  title="Reset to auto-detected IP"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── SpeedTest Iframe ── */}
      <div style={{
        position: 'relative',
        flex: 1,
        width: '100%',
        minHeight: '620px',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: '#0b1329',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      }}>
        <iframe
          key={iframeKey}
          src={embeddedUrl}
          title="OpenSpeedTest HTML5 Engine"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
          allow="fullscreen"
        />
      </div>

      {/* ── Mobile QR Code Modal ── */}
      {showQrModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}
        onClick={() => setShowQrModal(false)}
        >
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(6, 182, 212, 0.4)',
            borderRadius: 'var(--radius-lg, 14px)',
            padding: '24px 28px',
            maxWidth: 420,
            width: '100%',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8), 0 0 30px rgba(6, 182, 212, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 16,
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📱</span> Mobile & Wi-Fi SpeedTest
              </div>
              <button
                type="button"
                className="btn-tiny"
                style={{ fontSize: 14, padding: '2px 8px', cursor: 'pointer' }}
                onClick={() => setShowQrModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{
              background: '#080e1c',
              padding: 16,
              borderRadius: 12,
              border: '1px solid rgba(6, 182, 212, 0.25)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)'
            }}>
              <QRCodeSVG
                value={directUrl}
                size={210}
                bgColor="#080e1c"
                fgColor="#06b6d4"
                level="Q"
                includeMargin={false}
              />
            </div>

            <div style={{ width: '100%' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Scan with your Phone Camera or QR reader to test speed immediately:
              </div>
              <div style={{
                background: '#070b14',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 13,
                color: 'var(--cyan)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                wordBreak: 'break-all',
              }}>
                <span>{directUrl}</span>
                <button
                  type="button"
                  className="btn-tiny"
                  onClick={handleCopyLink}
                  style={{ marginLeft: 8, flexShrink: 0, cursor: 'pointer' }}
                >
                  {copied ? '✓' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.03)',
              padding: '8px 12px',
              borderRadius: 6,
              textAlign: 'left',
              width: '100%',
              lineHeight: 1.5,
            }}>
              💡 <strong>Host IP Detected:</strong> {activeIp}<br />
              Ensure your phone or tablet is connected to the same Wi-Fi router / subnet as this server to test local throughput without consuming cellular data.
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '9px 0', fontSize: 13 }}
              onClick={() => setShowQrModal(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
