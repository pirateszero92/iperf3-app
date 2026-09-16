import { useState, useEffect } from 'react'

export default function IpManagement() {
  const [subnets, setSubnets] = useState([])
  const [selectedSubnetId, setSelectedSubnetId] = useState(null)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'used' | 'available'
  const [searchQuery, setSearchQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [statusText, setStatusText] = useState('Scanner Idle')
  
  // Add subnet modal/form
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCidr, setNewCidr] = useState('192.168.1.0/24')
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')

  // Load subnets
  const fetchSubnets = async () => {
    try {
      const res = await fetch('/api/ipam/subnets')
      if (res.ok) {
        const data = await res.json()
        setSubnets(data)
        if (data.length > 0 && !selectedSubnetId) {
          setSelectedSubnetId(data[0].id)
        }
      }
    } catch (e) {}
  }

  useEffect(() => {
    fetchSubnets()
  }, [])

  const selectedSubnet = subnets.find(s => s.id === selectedSubnetId) || null

  const handleAddSubnet = async (e) => {
    e.preventDefault()
    setAddError('')
    if (!newCidr.trim()) return

    try {
      const res = await fetch('/api/ipam/subnets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cidr: newCidr.trim(),
          name: newName.trim() || undefined
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to add subnet')
      }

      const created = await res.json()
      setShowAddModal(false)
      setNewName('')
      await fetchSubnets()
      setSelectedSubnetId(created.id)
    } catch (err) {
      setAddError(err.message)
    }
  }

  const handleDeleteSubnet = async (subId, e) => {
    e.stopPropagation()
    if (!confirm('Are you sure you want to delete this subnet from IP Management?')) return
    try {
      await fetch(`/api/ipam/subnets/${subId}`, { method: 'DELETE' })
      const remaining = subnets.filter(s => s.id !== subId)
      setSubnets(remaining)
      if (selectedSubnetId === subId) {
        setSelectedSubnetId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {}
  }

  const handleScanSubnet = async () => {
    if (!selectedSubnet || scanning) return
    setScanning(true)
    setStatusText(`Scanning subnet ${selectedSubnet.cidr}...`)

    try {
      const res = await fetch(`/api/ipam/subnets/${selectedSubnet.id}/scan`, { method: 'POST' })
      if (!res.ok) {
        throw new Error('Subnet scan failed')
      }
      const updated = await res.json()
      setSubnets(prev => prev.map(s => s.id === updated.id ? updated : s))
      setStatusText(`Scan finished at ${new Date().toLocaleTimeString()}. Found ${updated.summary?.used || 0} online hosts.`)
    } catch (err) {
      setStatusText(`Scan error: ${err.message}`)
    } finally {
      setScanning(false)
    }
  }

  // Filter addresses
  const filteredAddresses = (selectedSubnet?.addresses || []).filter(addr => {
    if (filterMode === 'used' && addr.status !== 'Used') return false
    if (filterMode === 'available' && addr.status !== 'Available') return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matchIp = addr.ip.toLowerCase().includes(q)
      const matchDns = (addr.dns || '').toLowerCase().includes(q)
      const matchSys = (addr.system_name || '').toLowerCase().includes(q)
      const matchMac = (addr.machine_type || '').toLowerCase().includes(q)
      return matchIp || matchDns || matchSys || matchMac
    }
    return true
  })

  return (
    <div className="tab-page ipam-page">
      {/* ── Page Header ── */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h2>IP Address Management (IPAM)</h2>
          <p className="page-desc">Track, scan, and inspect IP subnet utilization and host online/offline status</p>
        </div>
      </div>

      <div className="ipam-container card">
        {/* ── Left Pane: Subnets List ── */}
        <div className="ipam-left-panel">
          <div className="ipam-left-header">
            <span className="ipam-title">Subnets</span>
            <button className="btn btn-tiny btn-primary" onClick={() => setShowAddModal(true)}>
              + Add
            </button>
          </div>

          <div className="ipam-subnet-list">
            {subnets.length === 0 ? (
              <div className="empty-subnets">No subnets defined. Click '+ Add' to create one.</div>
            ) : (
              subnets.map(sub => {
                const isSelected = sub.id === selectedSubnetId
                const used = sub.summary?.used || 0
                return (
                  <div
                    key={sub.id}
                    className={`ipam-subnet-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedSubnetId(sub.id)}
                  >
                    <div className="subnet-item-main">
                      <span className={`subnet-dot ${used > 0 ? 'online' : 'idle'}`} />
                      <div className="subnet-item-info">
                        <div className="subnet-cidr">{sub.network || sub.cidr}</div>
                        <div className="subnet-subtext">{sub.name || sub.cidr}</div>
                      </div>
                    </div>

                    <div className="subnet-item-actions">
                      <span className="badge-used-count">{used}</span>
                      <button
                        className="btn-icon-del"
                        title="Delete Subnet"
                        onClick={(e) => handleDeleteSubnet(sub.id, e)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ── Right Pane: Subnet Table & Controls ── */}
        <div className="ipam-right-panel">
          {selectedSubnet ? (
            <>
              {/* Top Controls matching screenshot */}
              <div className="ipam-top-bar">
                <div className="ipam-subnet-header-meta">
                  <div className="ipam-network-title">
                    <span className="net-icon">🌐</span>
                    <strong>{selectedSubnet.network} / {selectedSubnet.netmask}</strong>
                    <span className="subnet-name-tag">{selectedSubnet.name}</span>
                  </div>

                  <div className="ipam-controls-row">
                    <select
                      className="select-field select-filter"
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value)}
                    >
                      <option value="all">Display ALL addresses in Subnet</option>
                      <option value="used">Display Used (Online) only</option>
                      <option value="available">Display Available (Offline) only</option>
                    </select>

                    <input
                      type="text"
                      className="input-field input-ip-search"
                      placeholder="Search IP / Hostname..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />

                    <button
                      className="btn btn-primary btn-scan"
                      onClick={handleScanSubnet}
                      disabled={scanning}
                    >
                      {scanning ? '⏳ Scanning...' : '▶ Scan'}
                    </button>

                    <button
                      className="btn btn-secondary btn-refresh"
                      onClick={fetchSubnets}
                      disabled={scanning}
                    >
                      🔄 Refresh
                    </button>
                  </div>
                </div>

                {/* Subnet Statistics summary bar */}
                <div className="ipam-stats-bar">
                  <div className="ipam-stat-pill">
                    <span className="stat-label">Subnet size:</span>
                    <strong className="stat-val">{selectedSubnet.summary?.total || 0} addresses</strong>
                  </div>
                  <div className="ipam-stat-pill stat-used">
                    <span className="stat-label">Used (Online):</span>
                    <strong className="stat-val">{selectedSubnet.summary?.used || 0}</strong>
                  </div>
                  <div className="ipam-stat-pill stat-avail">
                    <span className="stat-label">Available (Offline):</span>
                    <strong className="stat-val">{selectedSubnet.summary?.available || 0}</strong>
                  </div>
                </div>
              </div>

              {/* Subnet Addresses Table */}
              <div className="ipam-table-wrap">
                <table className="ipam-table">
                  <thead>
                    <tr>
                      <th style={{ width: 45, textAlign: 'center' }}></th>
                      <th style={{ width: 140 }}>Address</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th>DNS</th>
                      <th style={{ width: 120 }}>Last Response</th>
                      <th>Machine Type</th>
                      <th>System Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAddresses.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="ipam-empty-row">
                          No IP addresses match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredAddresses.map((addr) => {
                        const isNetwork = addr.status === 'Subnet Address'
                        const isBroadcast = addr.status === 'Broadcast Address'
                        const isUsed = addr.status === 'Used'
                        const isAvailable = addr.status === 'Available'

                        return (
                          <tr key={addr.ip} className={`ipam-row ${isUsed ? 'row-used' : ''}`}>
                            <td style={{ textAlign: 'center' }}>
                              {isNetwork && <span className="icon-spec" title="Subnet Base">🌐</span>}
                              {isBroadcast && <span className="icon-spec" title="Broadcast">📢</span>}
                              {isUsed && <span className="icon-mark-used" title="Online Host">●</span>}
                              {isAvailable && <span className="icon-mark-avail" title="Available">✕</span>}
                            </td>
                            <td className="col-ip">
                              <code>{addr.ip}</code>
                            </td>
                            <td>
                              <span className={`ipam-status-badge status-${addr.status.toLowerCase().replace(' ', '-')}`}>
                                {addr.status}
                              </span>
                            </td>
                            <td className="col-dns">
                              {addr.dns ? <span>{addr.dns}</span> : <span className="text-dim">-</span>}
                            </td>
                            <td>
                              <span className={`last-resp-text ${isUsed ? 'resp-today' : 'resp-never'}`}>
                                {addr.last_response || 'Never'}
                              </span>
                            </td>
                            <td className="col-machine">
                              {addr.machine_type ? <span>{addr.machine_type}</span> : <span className="text-dim">-</span>}
                            </td>
                            <td className="col-system">
                              {addr.system_name ? <span>{addr.system_name}</span> : <span className="text-dim">-</span>}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bottom status bar */}
              <div className="ipam-footer-bar">
                <span>{statusText}</span>
                {selectedSubnet.last_scanned && (
                  <span>Last scanned: {new Date(selectedSubnet.last_scanned).toLocaleString()}</span>
                )}
              </div>
            </>
          ) : (
            <div className="ipam-no-selection">
              <p>Select a subnet on the left or add a new subnet to inspect addresses.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Add Subnet ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3>Add New Subnet</h3>
            <p className="page-desc">Enter a network CIDR to manage and monitor.</p>

            <form onSubmit={handleAddSubnet}>
              {addError && <div className="alert-error" style={{ marginBottom: 12 }}>{addError}</div>}

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="field-label">CIDR Notation (e.g. 10.1.1.0/24 or 192.168.1.0/24):</label>
                <input
                  type="text"
                  className="input-field"
                  value={newCidr}
                  onChange={(e) => setNewCidr(e.target.value)}
                  placeholder="192.168.1.0/24"
                  required
                />
                <span className="field-hint">Supports up to /22 (1,024 addresses)</span>
              </div>

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="field-label">Subnet Label / Friendly Name (Optional):</label>
                <input
                  type="text"
                  className="input-field"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Office LAN or Lab Network"
                />
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Subnet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
