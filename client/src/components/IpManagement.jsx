import { useState, useEffect } from 'react'

const PRESET_COLORS = [
  '#00d4ff', // Cyan
  '#00e887', // Green
  '#a855f7', // Purple
  '#ffbb00', // Amber
  '#ff4466', // Red
  '#3b82f6', // Blue
  '#ec4899', // Pink
]

export default function IpManagement() {
  const [subnets, setSubnets] = useState([])
  const [vlans, setVlans] = useState([])
  const [selectedSubnetId, setSelectedSubnetId] = useState(null)
  const [selectedVlanFilter, setSelectedVlanFilter] = useState('all') // 'all' | number
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'used' | 'available'
  const [searchQuery, setSearchQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const [statusText, setStatusText] = useState('Scanner Idle')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCidr, setNewCidr] = useState('192.168.1.0/24')
  const [newName, setNewName] = useState('')
  const [newVlanId, setNewVlanId] = useState('')
  const [addError, setAddError] = useState('')

  // VLAN Management Modal
  const [showVlanModal, setShowVlanModal] = useState(false)
  const [vlanForm, setVlanForm] = useState({ vlan_id: '', name: '', description: '', color: '#00d4ff' })
  const [editingVlanId, setEditingVlanId] = useState(null)
  const [vlanError, setVlanError] = useState('')

  // Subnet Meta / VLAN Assign Modal
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignSubnetName, setAssignSubnetName] = useState('')
  const [assignVlanId, setAssignVlanId] = useState('')
  const [assignError, setAssignError] = useState('')

  // Inline address edit state
  const [editingIp, setEditingIp] = useState(null)
  const [editSystemName, setEditSystemName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // ── Data Fetching ──────────────────────────────────────────────────────────
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

  const fetchVlans = async () => {
    try {
      const res = await fetch('/api/ipam/vlans')
      if (res.ok) {
        const data = await res.json()
        setVlans(data)
      }
    } catch (e) {}
  }

  useEffect(() => {
    fetchSubnets()
    fetchVlans()
  }, [])

  const selectedSubnet = subnets.find(s => s.id === selectedSubnetId) || null

  const getVlan = (vid) => vlans.find(v => v.vlan_id === Number(vid))
  const getVlanColor = (vid) => getVlan(vid)?.color || 'var(--cyan)'
  const getVlanName = (vid) => getVlan(vid)?.name || `VLAN ${vid}`

  // ── Subnet Add / Delete ────────────────────────────────────────────────────
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
          name: newName.trim() || undefined,
          vlan_id: newVlanId ? Number(newVlanId) : undefined,
        })
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to add subnet')
      }

      const created = await res.json()
      setShowAddModal(false)
      setNewName('')
      setNewVlanId('')
      await fetchSubnets()
      await fetchVlans()
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
      fetchVlans()
    } catch (err) {}
  }

  // ── Subnet Scan ────────────────────────────────────────────────────────────
  const handleScanSubnet = async () => {
    if (!selectedSubnet || scanning) return
    setScanning(true)
    setStatusText(`Scanning subnet ${selectedSubnet.cidr}...`)

    try {
      const res = await fetch(`/api/ipam/subnets/${selectedSubnet.id}/scan`, { method: 'POST' })
      if (!res.ok) throw new Error('Subnet scan failed')
      const updated = await res.json()
      setSubnets(prev => prev.map(s => s.id === updated.id ? updated : s))
      setStatusText(`Scan finished at ${new Date().toLocaleTimeString()}. Found ${updated.summary?.used || 0} online hosts.`)
    } catch (err) {
      setStatusText(`Scan error: ${err.message}`)
    } finally {
      setScanning(false)
    }
  }

  // ── Inline Edit System Name ────────────────────────────────────────────────
  const startEdit = (addr) => {
    setEditingIp(addr.ip)
    setEditSystemName(addr.system_name || '')
  }

  const saveEdit = async (ip) => {
    if (!selectedSubnet) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/ipam/subnets/${selectedSubnet.id}/address`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: ip,
          system_name: editSystemName.trim()
        })
      })
      if (res.ok) {
        setSubnets(prev => prev.map(s => {
          if (s.id !== selectedSubnet.id) return s
          return {
            ...s,
            addresses: s.addresses.map(a => a.ip === ip ? { ...a, system_name: editSystemName.trim() } : a)
          }
        }))
        setEditingIp(null)
      } else {
        const err = await res.json()
        alert(`Failed to save: ${err.detail || 'Error'}`)
      }
    } catch (err) {
      alert(`Failed to save: ${err.message}`)
    } finally {
      setSavingEdit(false)
    }
  }

  const cancelEdit = () => {
    setEditingIp(null)
  }

  // ── Subnet Metadata / VLAN Assignment Modal ───────────────────────────────
  const openAssignModal = () => {
    if (!selectedSubnet) return
    setAssignSubnetName(selectedSubnet.name || '')
    setAssignVlanId(selectedSubnet.vlan_id ? String(selectedSubnet.vlan_id) : '')
    setAssignError('')
    setShowAssignModal(true)
  }

  const handleSaveSubnetMeta = async (e) => {
    e.preventDefault()
    setAssignError('')
    try {
      const res = await fetch(`/api/ipam/subnets/${selectedSubnet.id}/meta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: assignSubnetName.trim() || undefined,
          vlan_id: assignVlanId ? Number(assignVlanId) : 0,
        })
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to update subnet')
      }
      const updated = await res.json()
      setSubnets(prev => prev.map(s => s.id === updated.id ? updated : s))
      setShowAssignModal(false)
      fetchVlans()
    } catch (err) {
      setAssignError(err.message)
    }
  }

  // ── VLAN CRUD Handlers ─────────────────────────────────────────────────────
  const handleOpenVlanModal = () => {
    setVlanForm({ vlan_id: '', name: '', description: '', color: '#00d4ff' })
    setEditingVlanId(null)
    setVlanError('')
    setShowVlanModal(true)
  }

  const handleEditVlan = (v) => {
    setVlanForm({
      vlan_id: String(v.vlan_id),
      name: v.name,
      description: v.description || '',
      color: v.color || '#00d4ff',
    })
    setEditingVlanId(v.vlan_id)
    setVlanError('')
  }

  const handleSaveVlan = async (e) => {
    e.preventDefault()
    setVlanError('')

    const vIdNum = Number(vlanForm.vlan_id)
    if (!vIdNum || vIdNum < 1 || vIdNum > 4094) {
      setVlanError('VLAN ID must be a valid number between 1 and 4094')
      return
    }
    if (!vlanForm.name.trim()) {
      setVlanError('VLAN Name is required')
      return
    }

    try {
      if (editingVlanId !== null) {
        // Update
        const res = await fetch(`/api/ipam/vlans/${editingVlanId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: vlanForm.name.trim(),
            description: vlanForm.description.trim(),
            color: vlanForm.color,
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || 'Failed to update VLAN')
        }
      } else {
        // Create
        const res = await fetch('/api/ipam/vlans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vlan_id: vIdNum,
            name: vlanForm.name.trim(),
            description: vlanForm.description.trim(),
            color: vlanForm.color,
          })
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || 'Failed to create VLAN')
        }
      }

      setVlanForm({ vlan_id: '', name: '', description: '', color: '#00d4ff' })
      setEditingVlanId(null)
      await fetchVlans()
      await fetchSubnets()
    } catch (err) {
      setVlanError(err.message)
    }
  }

  const handleDeleteVlan = async (vid) => {
    if (!confirm(`Are you sure you want to delete VLAN ${vid}? Any assigned subnets will become unassigned.`)) return
    try {
      const res = await fetch(`/api/ipam/vlans/${vid}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchVlans()
        await fetchSubnets()
        if (editingVlanId === vid) {
          setEditingVlanId(null)
          setVlanForm({ vlan_id: '', name: '', description: '', color: '#00d4ff' })
        }
      }
    } catch (e) {}
  }

  // ── Filtered Subnets (by VLAN) ─────────────────────────────────────────────
  const displayedSubnets = subnets.filter(s => {
    if (selectedVlanFilter === 'all') return true
    if (selectedVlanFilter === 'none') return !s.vlan_id
    return s.vlan_id === Number(selectedVlanFilter)
  })

  // ── Filtered Addresses (by status/search) ──────────────────────────────────
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
          <h1 className="page-title">IP Address & VLAN Management (IPAM)</h1>
          <p className="page-subtitle">Track subnets, assign VLAN segments, and inspect host online/offline status</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={handleOpenVlanModal}>
            🏷️ Manage VLANs ({vlans.length})
          </button>
        </div>
      </div>

      <div className="ipam-container card">
        {/* ── Left Pane: Subnets List ── */}
        <div className="ipam-left-panel">
          <div className="ipam-left-header">
            <span className="ipam-title">Subnets ({displayedSubnets.length})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-tiny btn-success" onClick={() => setShowAddModal(true)}>
                + Add Subnet
              </button>
            </div>
          </div>

          {/* VLAN Filter Bar */}
          {vlans.length > 0 && (
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}>
              <select
                className="form-select"
                style={{ fontSize: 12, padding: '4px 8px' }}
                value={selectedVlanFilter}
                onChange={(e) => setSelectedVlanFilter(e.target.value)}
              >
                <option value="all">🌐 All VLANs ({subnets.length})</option>
                {vlans.map(v => (
                  <option key={v.vlan_id} value={v.vlan_id}>
                    🏷️ VLAN {v.vlan_id}: {v.name} ({v.subnet_count || 0})
                  </option>
                ))}
                <option value="none">⚪ Unassigned VLAN</option>
              </select>
            </div>
          )}

          <div className="ipam-subnet-list">
            {displayedSubnets.length === 0 ? (
              <div className="empty-subnets">
                {subnets.length === 0
                  ? "No subnets defined. Click '+ Add Subnet' to create one."
                  : "No subnets match the selected VLAN filter."}
              </div>
            ) : (
              displayedSubnets.map(sub => {
                const isSelected = sub.id === selectedSubnetId
                const used = sub.summary?.used || 0
                const vlanObj = sub.vlan_id ? getVlan(sub.vlan_id) : null

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
                        {vlanObj && (
                          <div style={{ marginTop: 3 }}>
                            <span
                              className="vlan-tag-pill"
                              style={{
                                borderColor: vlanObj.color ? `${vlanObj.color}55` : 'rgba(0,212,255,0.3)',
                                color: vlanObj.color || 'var(--cyan)',
                                background: vlanObj.color ? `${vlanObj.color}15` : 'rgba(0,212,255,0.08)'
                              }}
                            >
                              🏷️ VLAN {vlanObj.vlan_id}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="subnet-item-actions">
                      <span className="badge-used-count" title={`${used} Online Hosts`}>{used}</span>
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
              {/* Top Controls */}
              <div className="ipam-top-bar">
                <div className="ipam-subnet-header-meta">
                  <div className="ipam-network-title">
                    <span className="net-icon">🌐</span>
                    <strong>{selectedSubnet.network} / {selectedSubnet.netmask}</strong>
                    <span className="subnet-name-tag">{selectedSubnet.name}</span>

                    {/* VLAN Badge with click to edit/reassign */}
                    {selectedSubnet.vlan_id ? (
                      <span
                        className="vlan-badge-interactive"
                        onClick={openAssignModal}
                        title="Click to edit Subnet Name or VLAN Assignment"
                        style={{
                          color: getVlanColor(selectedSubnet.vlan_id),
                          borderColor: `${getVlanColor(selectedSubnet.vlan_id)}44`,
                          background: `${getVlanColor(selectedSubnet.vlan_id)}18`,
                        }}
                      >
                        🏷️ VLAN {selectedSubnet.vlan_id}: {getVlanName(selectedSubnet.vlan_id)}
                        <span className="vlan-edit-icon" style={{ marginLeft: 6, fontSize: 11 }}>✏️</span>
                      </span>
                    ) : (
                      <button
                        className="btn btn-tiny btn-ghost"
                        onClick={openAssignModal}
                        style={{ fontSize: 11, padding: '2px 8px' }}
                      >
                        + Assign VLAN
                      </button>
                    )}
                  </div>

                  <div className="ipam-controls-row">
                    <select
                      className="form-select select-filter"
                      value={filterMode}
                      onChange={(e) => setFilterMode(e.target.value)}
                    >
                      <option value="all">Display ALL addresses in Subnet</option>
                      <option value="used">Display Used (Online) only</option>
                      <option value="available">Display Available (Offline) only</option>
                    </select>

                    <input
                      type="text"
                      className="form-input input-ip-search"
                      placeholder="Search IP / Hostname..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />

                    <button
                      className="btn btn-success btn-scan"
                      onClick={handleScanSubnet}
                      disabled={scanning}
                    >
                      {scanning ? '⏳ Scanning...' : '▶ Scan'}
                    </button>

                    <button
                      className="btn btn-ghost btn-refresh"
                      onClick={() => { fetchSubnets(); fetchVlans(); }}
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
                  {selectedSubnet.vlan_id && (
                    <div className="ipam-stat-pill" style={{ marginLeft: 'auto' }}>
                      <span className="stat-label">Segment:</span>
                      <strong className="stat-val" style={{ color: getVlanColor(selectedSubnet.vlan_id) }}>
                        VLAN {selectedSubnet.vlan_id} ({getVlanName(selectedSubnet.vlan_id)})
                      </strong>
                    </div>
                  )}
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
                        const isEditingThis = editingIp === addr.ip

                        return (
                          <tr key={addr.ip} className={`ipam-row ${isUsed ? 'row-used' : ''}`}>
                            <td style={{ textAlign: 'center' }}>
                              {isNetwork && <span className="icon-spec" title="Subnet Base">🌐</span>}
                              {isBroadcast && <span className="icon-spec" title="Broadcast">📢</span>}
                              {isUsed && <span className="icon-mark-used" title="Online Host">●</span>}
                              {isAvailable && <span className="icon-mark-avail" title="Available">✕</span>}
                            </td>
                            <td>
                              <strong style={{ fontFamily: 'monospace' }}>{addr.ip}</strong>
                            </td>
                            <td>
                              <span className={`ipam-status-badge status-${addr.status.toLowerCase().replace(/\s+/g, '-')}`}>
                                {addr.status}
                              </span>
                            </td>
                            <td style={{ color: addr.dns ? 'var(--cyan)' : 'var(--text-muted)' }}>
                              {addr.dns || '-'}
                            </td>
                            <td>
                              <span className={`last-resp-text ${addr.last_response.includes('ms') ? 'resp-today' : addr.last_response === 'Never' ? 'resp-never' : ''}`}>
                                {addr.last_response}
                              </span>
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>
                              {addr.machine_type || '-'}
                            </td>
                            <td>
                              {isEditingThis ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <input
                                    type="text"
                                    className="form-input"
                                    style={{ padding: '3px 8px', fontSize: 12, height: 28, minWidth: 150 }}
                                    value={editSystemName}
                                    onChange={(e) => setEditSystemName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEdit(addr.ip)
                                      if (e.key === 'Escape') cancelEdit()
                                    }}
                                    autoFocus
                                    placeholder="Enter system name..."
                                  />
                                  <button
                                    className="btn-tiny"
                                    style={{ background: 'var(--green-dim)', color: 'var(--green)' }}
                                    onClick={() => saveEdit(addr.ip)}
                                    disabled={savingEdit}
                                    title="Save"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className="btn-tiny"
                                    onClick={cancelEdit}
                                    title="Cancel"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                  <span style={{ fontWeight: addr.system_name ? 600 : 400, color: addr.system_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                    {addr.system_name || '-'}
                                  </span>
                                  {!isNetwork && !isBroadcast && (
                                    <button
                                      className="btn-edit-inline"
                                      onClick={() => startEdit(addr)}
                                      title="Edit System Name"
                                    >
                                      ✏️
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Status Footer */}
              <div className="ipam-footer-bar">
                <span>{statusText}</span>
                <span>
                  {selectedSubnet.last_scanned
                    ? `Last scanned: ${new Date(selectedSubnet.last_scanned).toLocaleString()}`
                    : 'Not yet scanned in this session'}
                </span>
              </div>
            </>
          ) : (
            <div className="ipam-no-selection">
              <span>Select a subnet on the left or add a new subnet to inspect addresses.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal 1: Add New Subnet ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="card-title" style={{ fontSize: 16, marginBottom: 8 }}>➕ Add New Subnet</h3>
            <p className="page-desc" style={{ marginBottom: 16, fontSize: 12 }}>Enter a network CIDR and optionally assign a VLAN.</p>

            <form onSubmit={handleAddSubnet}>
              {addError && <div className="alert-error" style={{ marginBottom: 12 }}>{addError}</div>}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">CIDR Notation (e.g. 10.1.1.0/24 or 192.168.1.0/24)</label>
                <input
                  type="text"
                  className="form-input"
                  value={newCidr}
                  onChange={(e) => setNewCidr(e.target.value)}
                  placeholder="192.168.1.0/24"
                  required
                />
                <span className="field-hint" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Supports up to /22 (1,024 addresses)
                </span>
              </div>

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Subnet Label / Friendly Name (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Office LAN or Lab Network"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Assign VLAN (Optional)</label>
                <select
                  className="form-select"
                  value={newVlanId}
                  onChange={(e) => setNewVlanId(e.target.value)}
                >
                  <option value="">-- None / Unassigned --</option>
                  {vlans.map(v => (
                    <option key={v.vlan_id} value={v.vlan_id}>
                      🏷️ VLAN {v.vlan_id} - {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-success">
                  Create Subnet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal 2: Assign VLAN / Edit Subnet Metadata ── */}
      {showAssignModal && selectedSubnet && (
        <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 className="card-title" style={{ fontSize: 16, marginBottom: 8 }}>🏷️ Subnet Details & VLAN Assignment</h3>
            <p className="page-desc" style={{ marginBottom: 16, fontSize: 12 }}>
              Configure segment name and assigned VLAN for <strong>{selectedSubnet.cidr}</strong>
            </p>

            <form onSubmit={handleSaveSubnetMeta}>
              {assignError && <div className="alert-error" style={{ marginBottom: 12 }}>{assignError}</div>}

              <div className="form-group" style={{ marginBottom: 14 }}>
                <label className="form-label">Subnet Friendly Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={assignSubnetName}
                  onChange={(e) => setAssignSubnetName(e.target.value)}
                  placeholder="e.g. Corporate Lab"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Assigned VLAN Segment</label>
                <select
                  className="form-select"
                  value={assignVlanId}
                  onChange={(e) => setAssignVlanId(e.target.value)}
                >
                  <option value="">⚪ Unassigned (No VLAN)</option>
                  {vlans.map(v => (
                    <option key={v.vlan_id} value={v.vlan_id}>
                      🏷️ VLAN {v.vlan_id} - {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-text"
                  onClick={() => {
                    setShowAssignModal(false)
                    handleOpenVlanModal()
                  }}
                  style={{ color: 'var(--cyan)' }}
                >
                  ⚙️ Manage VLAN Pool
                </button>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowAssignModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-success">
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal 3: Dedicated VLAN Management Dialog ── */}
      {showVlanModal && (
        <div className="modal-overlay" onClick={() => setShowVlanModal(false)}>
          <div className="modal-content card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 className="card-title" style={{ fontSize: 18, marginBottom: 4 }}>🏷️ VLAN Management Pool</h3>
                <p className="page-desc" style={{ fontSize: 12 }}>Define network segments (802.1Q VLANs) to assign across your subnets.</p>
              </div>
              <button className="btn-icon" onClick={() => setShowVlanModal(false)} title="Close">✕</button>
            </div>

            {/* VLAN Add / Edit Form */}
            <div className="card" style={{ background: 'rgba(0,0,0,0.25)', marginBottom: 20, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                  {editingVlanId !== null ? `✏️ Edit VLAN ${editingVlanId}` : '➕ Add New VLAN'}
                </strong>
                {editingVlanId !== null && (
                  <button
                    className="btn btn-tiny btn-ghost"
                    onClick={() => {
                      setEditingVlanId(null)
                      setVlanForm({ vlan_id: '', name: '', description: '', color: '#00d4ff' })
                    }}
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              {vlanError && <div className="alert-error" style={{ marginBottom: 12 }}>{vlanError}</div>}

              <form onSubmit={handleSaveVlan}>
                <div className="form-grid-3" style={{ marginBottom: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">VLAN ID (1 - 4094)</label>
                    <input
                      type="number"
                      className="form-input"
                      min={1}
                      max={4094}
                      value={vlanForm.vlan_id}
                      onChange={(e) => setVlanForm({ ...vlanForm, vlan_id: e.target.value })}
                      placeholder="e.g. 10"
                      disabled={editingVlanId !== null}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">VLAN Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={vlanForm.name}
                      onChange={(e) => setVlanForm({ ...vlanForm, name: e.target.value })}
                      placeholder="e.g. Corporate Lab"
                      required
                    />
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Color Badge</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 40 }}>
                      {PRESET_COLORS.map(c => (
                        <span
                          key={c}
                          onClick={() => setVlanForm({ ...vlanForm, color: c })}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: c,
                            cursor: 'pointer',
                            display: 'inline-block',
                            boxShadow: vlanForm.color === c ? `0 0 0 2px #fff, 0 0 8px ${c}` : 'none',
                            transform: vlanForm.color === c ? 'scale(1.15)' : 'scale(1)',
                            transition: 'all 0.15s'
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="form-label">Description (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={vlanForm.description}
                    onChange={(e) => setVlanForm({ ...vlanForm, description: e.target.value })}
                    placeholder="e.g. Main development and staging laboratory"
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-success">
                    {editingVlanId !== null ? '✓ Save VLAN Changes' : '➕ Create VLAN'}
                  </button>
                </div>
              </form>
            </div>

            {/* Configured VLANs List */}
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 10 }}>
              Configured VLANs ({vlans.length})
            </h4>

            {vlans.length === 0 ? (
              <div className="empty-state">No VLANs defined yet. Use the form above to add your first VLAN.</div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>VLAN ID</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th style={{ width: 130 }}>Assigned Subnets</th>
                      <th style={{ width: 100, textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vlans.map(v => (
                      <tr key={v.vlan_id}>
                        <td>
                          <span
                            className="vlan-tag-pill"
                            style={{
                              borderColor: `${v.color || '#00d4ff'}66`,
                              color: v.color || 'var(--cyan)',
                              background: `${v.color || '#00d4ff'}18`,
                              fontWeight: 700
                            }}
                          >
                            VLAN {v.vlan_id}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{v.name}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{v.description || '-'}</td>
                        <td>
                          {v.assigned_subnets && v.assigned_subnets.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {v.assigned_subnets.map(s => (
                                <code key={s.id} style={{ fontSize: 11, color: 'var(--text-primary)' }}>
                                  {s.cidr}
                                </code>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>None</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button
                              className="btn-tiny"
                              onClick={() => handleEditVlan(v)}
                              title="Edit VLAN"
                            >
                              ✏️
                            </button>
                            <button
                              className="btn-tiny"
                              style={{ color: 'var(--red)' }}
                              onClick={() => handleDeleteVlan(v.vlan_id)}
                              title="Delete VLAN"
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
