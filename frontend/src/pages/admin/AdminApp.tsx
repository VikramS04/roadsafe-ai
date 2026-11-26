import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import { adminApi, AdminUser } from '../../services/adminApi';
import { AdminHazardDetail } from './AdminHazardDetail';

type AdminTab = 'dashboard' | 'queue' | 'map' | 'devices' | 'settings' | 'audit';

function MapClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export const AdminApp: React.FC = () => {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('queue');
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Queue state
  const [queueData, setQueueData] = useState<any>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  // Dashboard state
  const [dashData, setDashData] = useState<any>(null);

  // Official Hazard Map creator state
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number }>({ lat: 25.5788, lng: 91.8933 });
  const [newHazType, setNewHazType] = useState('landslide');
  const [newHazSeverity, setNewHazSeverity] = useState('high');
  const [newHazNote, setNewHazNote] = useState('');
  const [newHazVehicles, setNewHazVehicles] = useState<string[]>(['truck', 'car', 'suv', 'ambulance', 'bike']);

  // Devices state
  const [devices, setDevices] = useState<any[]>([]);

  // Settings state
  const [settings, setSettings] = useState<any>(null);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    adminApi
      .me()
      .then((res) => setAdmin(res.admin))
      .catch(() => setAdmin(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadQueue = useCallback(async () => {
    if (!admin) return;
    setQueueLoading(true);
    try {
      const res = await adminApi.getHazards({
        status: statusFilter,
        source: sourceFilter,
        type: typeFilter,
        severity: severityFilter,
        q: searchQuery,
        needsReview: needsReviewOnly,
        page,
        limit: 20,
      });
      setQueueData(res);
    } catch (err: any) {
      notify(err.message || 'Failed to load hazard queue', 'error');
    } finally {
      setQueueLoading(false);
    }
  }, [admin, statusFilter, sourceFilter, typeFilter, severityFilter, searchQuery, needsReviewOnly, page, notify]);

  const loadDashboard = useCallback(async () => {
    if (!admin) return;
    try {
      const res = await adminApi.getDashboard();
      setDashData(res);
    } catch (err: any) {
      notify(err.message || 'Failed to load dashboard', 'error');
    }
  }, [admin, notify]);

  useEffect(() => {
    if (!admin) return;
    if (activeTab === 'queue') loadQueue();
    else if (activeTab === 'dashboard') loadDashboard();
    else if (activeTab === 'devices') adminApi.getDevices().then((r) => setDevices(r.devices || [])).catch(() => {});
    else if (activeTab === 'settings' && admin.role === 'admin') {
      adminApi.getSettings().then((r) => setSettings(r.settings)).catch(() => {});
    } else if (activeTab === 'audit') {
      adminApi.getAuditLog(1, 50).then((r) => setAuditLogs(r.items || [])).catch(() => {});
    }
  }, [admin, activeTab, loadQueue, loadDashboard]);

  // Live SSE feed for dashboard
  useEffect(() => {
    if (!admin || activeTab !== 'dashboard') return;
    const es = new EventSource('/api/v1/admin/events/stream', { withCredentials: true });
    es.addEventListener('hazard_created', () => loadDashboard());
    es.addEventListener('hazard_updated', () => loadDashboard());
    return () => es.close();
  }, [admin, activeTab, loadDashboard]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await adminApi.login(loginEmail, loginPassword);
      setAdmin(res.admin);
      setLoginPassword('');
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleBulkAction = (action: string) => {
    if (selectedIds.length === 0) return;
    const run = async () => {
      try {
        await adminApi.bulkHazards(selectedIds, action);
        setSelectedIds([]);
        notify(`Bulk "${action}" applied to ${selectedIds.length} reports`);
        loadQueue();
      } catch (err: any) {
        notify(err.message || 'Bulk action failed', 'error');
      }
    };
    if (action === 'delete' || action === 'reject') {
      setConfirmDialog({
        title: `Bulk ${action.toUpperCase()}`,
        message: `Apply "${action}" to ${selectedIds.length} selected hazard reports?`,
        onConfirm: run,
      });
    } else {
      run();
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center text-sm">
        Checking admin session...
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col gap-4"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-lg">🛡️</div>
            <div>
              <h1 className="text-base font-bold text-white">RoadSafe AI Admin</h1>
              <p className="text-xs text-slate-400">Protected Hazard Moderation Console</p>
            </div>
          </div>

          {loginError && (
            <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-700 text-rose-200 text-xs">{loginError}</div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium" htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="admin@domain.com"
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium" htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              required
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loginLoading}
            className="py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition disabled:opacity-50"
          >
            {loginLoading ? 'Signing in...' : 'Sign In'}
          </button>

          <a href="/" className="text-center text-xs text-slate-400 hover:text-slate-200">
            ← Back to Public Map
          </a>
        </form>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: string; adminOnly?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'queue', label: 'Queue', icon: '📋' },
    { id: 'map', label: 'Map', icon: '🗺️' },
    { id: 'devices', label: 'Devices', icon: '📱' },
    { id: 'settings', label: 'Settings', icon: '⚙️', adminOnly: true },
    { id: 'audit', label: 'Audit Log', icon: '📜' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <div>
            <h1 className="text-sm font-bold text-white">RoadSafe AI Moderation</h1>
            <p className="text-[11px] text-slate-400">
              {admin.email} • <span className="uppercase text-emerald-400 font-semibold">{admin.role}</span>
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1">
          {tabs
            .filter((t) => !t.adminOnly || admin.role === 'admin')
            .map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  setSelectedHazardId(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                  activeTab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
        </nav>

        <div className="flex items-center gap-2">
          <a href="/" className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200">
            Public Map ↗
          </a>
          <button
            onClick={() => adminApi.logout().then(() => setAdmin(null))}
            className="px-2.5 py-1.5 rounded-lg bg-rose-900/70 hover:bg-rose-800 text-xs text-rose-200 font-semibold"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-7xl w-full mx-auto">
        {selectedHazardId ? (
          <AdminHazardDetail
            hazardId={selectedHazardId}
            onBack={() => {
              setSelectedHazardId(null);
              loadQueue();
            }}
            onNotify={notify}
            onConfirmDestructive={(title, message, onConfirm) => setConfirmDialog({ title, message, onConfirm })}
          />
        ) : activeTab === 'queue' ? (
          <div className="flex flex-col gap-3">
            {/* Status Badges */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {['all', 'unverified', 'confirmed', 'cleared', 'expired', 'rejected'].map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setStatusFilter(st);
                      setPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                      statusFilter === st
                        ? 'bg-blue-600 text-white border-blue-500'
                        : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                    }`}
                  >
                    <span className="capitalize">{st}</span>
                    {st !== 'all' && queueData?.statusCounts && (
                      <span className="ml-1.5 px-1.5 py-0.2 bg-slate-950/70 rounded-full text-[10px]">
                        {queueData.statusCounts[st] || 0}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={adminApi.exportUrl('csv', statusFilter)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700"
                >
                  Export CSV
                </a>
                <a
                  href={adminApi.exportUrl('geojson', statusFilter)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700"
                >
                  Export GeoJSON
                </a>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs">
              <input
                type="text"
                placeholder="Search note, road edge, device..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="flex-1 min-w-[180px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              >
                <option value="all">All Sources</option>
                <option value="community">Community</option>
                <option value="admin">Official Admin</option>
                <option value="ndma_sachet">NDMA SACHET</option>
                <option value="usgs">USGS Seismic</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              >
                <option value="all">All Types</option>
                <option value="landslide">Landslide</option>
                <option value="flooded_road">Flooded Road</option>
                <option value="fallen_tree">Fallen Tree</option>
                <option value="damaged_road">Damaged Road</option>
                <option value="bridge_damaged">Bridge Damaged</option>
                <option value="road_blocked">Road Blocked</option>
              </select>
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={needsReviewOnly}
                  onChange={(e) => setNeedsReviewOnly(e.target.checked)}
                />
                <span>Needs Review</span>
              </label>
            </div>

            {/* Bulk Action Bar */}
            {selectedIds.length > 0 && (
              <div className="bg-blue-950/70 border border-blue-700 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-blue-200">{selectedIds.length} selected</span>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => handleBulkAction('confirm')} className="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold">Confirm</button>
                  <button onClick={() => handleBulkAction('clear')} className="px-2.5 py-1 rounded bg-blue-600 text-white font-bold">Clear</button>
                  <button onClick={() => handleBulkAction('expire_now')} className="px-2.5 py-1 rounded bg-amber-600 text-white font-bold">Expire</button>
                  <button onClick={() => handleBulkAction('reject')} className="px-2.5 py-1 rounded bg-rose-700 text-white font-bold">Reject</button>
                  <button onClick={() => handleBulkAction('delete')} className="px-2.5 py-1 rounded bg-rose-900 text-rose-100 font-bold">Delete</button>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3 w-8">
                      <input
                        type="checkbox"
                        checked={queueData?.items?.length > 0 && selectedIds.length === queueData.items.length}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? queueData.items.map((i: any) => i.id) : [])
                        }
                      />
                    </th>
                    <th className="p-3">Hazard</th>
                    <th className="p-3">Road</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Votes</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Reported</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {queueLoading ? (
                    <tr><td colSpan={8} className="p-6 text-center text-slate-400">Loading reports...</td></tr>
                  ) : !queueData?.items?.length ? (
                    <tr><td colSpan={8} className="p-6 text-center text-slate-400">No hazard reports match your filters.</td></tr>
                  ) : (
                    queueData.items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-800/50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(item.id)}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)
                              )
                            }
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-slate-100 capitalize">{item.type.replace(/_/g, ' ')}</div>
                          <div className="text-[10px] text-slate-400 uppercase">{item.severity}</div>
                        </td>
                        <td className="p-3 text-slate-300">{item.roadName}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-800 border border-slate-700">
                            {item.status}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300">+{item.confirmCount} / -{item.noCount} / C:{item.clearCount}</td>
                        <td className="p-3 text-slate-400 capitalize">{item.source}</td>
                        <td className="p-3 text-slate-400">{new Date(item.reportedAt).toLocaleDateString()}</td>
                        <td className="p-3">
                          <button
                            onClick={() => setSelectedHazardId(item.id)}
                            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : activeTab === 'dashboard' ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">Total Reports</div>
                <div className="text-2xl font-black text-white mt-1">{dashData?.totalReports ?? 0}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">Confirmed Active</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">{dashData?.byStatus?.confirmed ?? 0}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">Unverified Queue</div>
                <div className="text-2xl font-black text-amber-400 mt-1">{dashData?.byStatus?.unverified ?? 0}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-400">Avg Time to Confirm</div>
                <div className="text-2xl font-black text-blue-400 mt-1">{dashData?.avgTimeToConfirmMin ?? 0} min</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">Top Hazard Roads</h3>
                <div className="divide-y divide-slate-800 text-xs">
                  {(dashData?.topRoads || []).map((r: any) => (
                    <div key={r.edgeId} className="py-2 flex justify-between">
                      <span className="text-slate-200">{r.roadName}</span>
                      <span className="font-bold text-amber-400">{r.count} reports</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="text-sm font-bold text-white mb-3">Live Feed (Auto-updates via SSE)</h3>
                <div className="divide-y divide-slate-800 text-xs max-h-64 overflow-y-auto">
                  {(dashData?.recentFeed || []).map((f: any) => (
                    <div key={f.id} className="py-2 flex items-center justify-between gap-2">
                      <span className="capitalize font-semibold text-slate-200">{f.type.replace(/_/g, ' ')}</span>
                      <span className="text-slate-400 uppercase text-[10px]">{f.status}</span>
                      <button
                        onClick={() => setSelectedHazardId(f.id)}
                        className="text-blue-400 hover:underline"
                      >
                        Inspect
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'map' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-[480px]">
              <MapContainer center={[pickedCoords.lat, pickedCoords.lng]} zoom={12} className="w-full h-full">
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapClickPicker onPick={(lat, lng) => setPickedCoords({ lat, lng })} />
                <Marker position={[pickedCoords.lat, pickedCoords.lng]} />
              </MapContainer>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await adminApi.createOfficialHazard({
                    type: newHazType,
                    severity: newHazSeverity,
                    latitude: pickedCoords.lat,
                    longitude: pickedCoords.lng,
                    note: newHazNote,
                    vehicleClasses: newHazVehicles,
                  });
                  notify('Official hazard created and snapped to nearest road edge');
                  setNewHazNote('');
                } catch (err: any) {
                  notify(err.message || 'Failed to create official hazard', 'error');
                }
              }}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 text-xs"
            >
              <h2 className="text-sm font-bold text-white">Create Official Hazard / Closure</h2>
              <p className="text-slate-400">Click anywhere on the map to pick coordinates ({pickedCoords.lat.toFixed(4)}, {pickedCoords.lng.toFixed(4)}).</p>
              <select value={newHazType} onChange={(e) => setNewHazType(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100">
                <option value="landslide">Landslide</option>
                <option value="road_blocked">Road Blocked</option>
                <option value="bridge_damaged">Bridge Damaged</option>
                <option value="flooded_road">Flooded Road</option>
                <option value="damaged_road">Damaged Road</option>
              </select>
              <select value={newHazSeverity} onChange={(e) => setNewHazSeverity(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100">
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <div className="flex flex-wrap gap-2">
                {['bike', 'car', 'suv', 'truck', 'ambulance'].map((v) => (
                  <label key={v} className="flex items-center gap-1 capitalize">
                    <input
                      type="checkbox"
                      checked={newHazVehicles.includes(v)}
                      onChange={(e) =>
                        setNewHazVehicles((prev) => (e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)))
                      }
                    />
                    {v}
                  </label>
                ))}
              </div>
              <input
                type="text"
                placeholder="Official advisory note..."
                value={newHazNote}
                onChange={(e) => setNewHazNote(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-100"
              />
              <button type="submit" className="py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
                Publish Confirmed Official Hazard
              </button>
            </form>
          </div>
        ) : activeTab === 'devices' ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Device ID</th>
                  <th className="p-3">Reliability</th>
                  <th className="p-3">Reports / Votes</th>
                  <th className="p-3">Rate Limit Hits</th>
                  <th className="p-3">Flags</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {devices.map((d) => (
                  <tr key={d.deviceId}>
                    <td className="p-3 font-mono text-slate-200">{d.deviceId.slice(0, 16)}...</td>
                    <td className="p-3">{d.reliabilityScore.toFixed(2)}</td>
                    <td className="p-3">{d.reportCount} / {d.voteCount}</td>
                    <td className="p-3">{d.rateLimitHits}</td>
                    <td className="p-3">
                      {d.isBlocked && <span className="px-1.5 py-0.5 rounded bg-rose-900 text-rose-200 mr-1">Blocked</span>}
                      {d.isShadowBanned && <span className="px-1.5 py-0.5 rounded bg-amber-900 text-amber-200 mr-1">Shadow-banned</span>}
                      {d.isFlagged && <span className="px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-200">Flagged</span>}
                    </td>
                    <td className="p-3 flex flex-wrap gap-1">
                      <button
                        onClick={async () => {
                          await adminApi.updateDevice(d.deviceId, d.isFlagged ? 'unflag' : 'flag');
                          adminApi.getDevices().then((r) => setDevices(r.devices || []));
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700"
                      >
                        {d.isFlagged ? 'Unflag' : 'Flag'}
                      </button>
                      <button
                        onClick={async () => {
                          await adminApi.updateDevice(d.deviceId, d.isShadowBanned ? 'unshadow_ban' : 'shadow_ban');
                          adminApi.getDevices().then((r) => setDevices(r.devices || []));
                        }}
                        className="px-2 py-1 rounded bg-amber-900/70 hover:bg-amber-800"
                      >
                        {d.isShadowBanned ? 'Unshadow' : 'Shadow-ban'}
                      </button>
                      <button
                        onClick={async () => {
                          await adminApi.updateDevice(d.deviceId, d.isBlocked ? 'unblock' : 'block');
                          adminApi.getDevices().then((r) => setDevices(r.devices || []));
                        }}
                        className="px-2 py-1 rounded bg-rose-900/70 hover:bg-rose-800"
                      >
                        {d.isBlocked ? 'Unblock' : 'Block'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : activeTab === 'settings' && admin.role === 'admin' && settings ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await adminApi.updateSettings({
                  confirmThreshold: Number(settings.confirmThreshold),
                  clearThreshold: Number(settings.clearThreshold),
                  defaultExpiryHours: Number(settings.defaultExpiryHours),
                  proximityRadiusKm: Number(settings.proximityRadiusKm),
                  maxReportsPerHour: Number(settings.maxReportsPerHour),
                });
                setSettings(res.settings);
                notify(`Settings saved (version ${res.settings.version})`);
              } catch (err: any) {
                notify(err.message || 'Failed to update settings', 'error');
              }
            }}
            className="max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Moderation & Threshold Settings</h2>
              <span className="text-slate-400">Version {settings.version}</span>
            </div>
            {[
              { key: 'confirmThreshold', label: 'Confirm Vote Threshold' },
              { key: 'clearThreshold', label: 'Clear Vote Threshold' },
              { key: 'defaultExpiryHours', label: 'Default Expiry (hours)' },
              { key: 'proximityRadiusKm', label: 'Vote Proximity Radius (km)' },
              { key: 'maxReportsPerHour', label: 'Max Reports per Device / Hour' },
            ].map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label className="text-slate-400">{f.label}</label>
                <input
                  type="number"
                  step="any"
                  value={settings[f.key]}
                  onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-white"
                />
              </div>
            ))}
            <button type="submit" className="py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold mt-1">
              Save Settings
            </button>
          </form>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Admin</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target</th>
                  <th className="p-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="p-3 text-slate-400">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-slate-200">{a.adminEmail}</td>
                    <td className="p-3 font-semibold text-blue-400">{a.action}</td>
                    <td className="p-3 font-mono text-slate-400">{a.targetType}:{a.targetId?.slice(0, 8)}</td>
                    <td className="p-3 text-slate-500">{a.ipAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[3000] bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-sm w-full flex flex-col gap-3">
            <h3 className="text-sm font-bold text-white">{confirmDialog.title}</h3>
            <p className="text-xs text-slate-300">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-xs text-white font-bold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-[3000] px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold border ${
            toast.type === 'error'
              ? 'bg-rose-950 border-rose-600 text-rose-100'
              : 'bg-emerald-950 border-emerald-600 text-emerald-100'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default AdminApp;
