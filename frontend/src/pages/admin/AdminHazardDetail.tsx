import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import { adminApi } from '../../services/adminApi';

interface AdminHazardDetailProps {
  hazardId: string;
  onBack: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onConfirmDestructive: (title: string, message: string, onConfirm: () => void) => void;
}

export const AdminHazardDetail: React.FC<AdminHazardDetailProps> = ({
  hazardId,
  onBack,
  onNotify,
  onConfirmDestructive,
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState('');
  const [editSeverity, setEditSeverity] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getHazardDetail(hazardId);
      setData(res);
      setEditType(res.report.type);
      setEditSeverity(res.report.severity);
      setEditNote(res.report.note || '');
      setEditLat(String(res.report.lat));
      setEditLng(String(res.report.lng));
    } catch (err: any) {
      onNotify(err.message || 'Failed to load hazard detail', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [hazardId]);

  const handleAction = async (action: string, extra: Record<string, any> = {}) => {
    try {
      await adminApi.updateHazard(hazardId, { action, ...extra });
      onNotify(`Action "${action}" applied successfully`);
      load();
    } catch (err: any) {
      onNotify(err.message || 'Action failed', 'error');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.updateHazard(hazardId, {
        type: editType,
        severity: editSeverity,
        note: editNote,
        latitude: parseFloat(editLat),
        longitude: parseFloat(editLng),
      });
      setEditMode(false);
      onNotify('Hazard updated and re-snapped to nearest road edge');
      load();
    } catch (err: any) {
      onNotify(err.message || 'Update failed', 'error');
    }
  };

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading hazard detail...</div>;
  if (!data?.report) return <div className="p-6 text-rose-400 text-sm">Report not found.</div>;

  const { report, segment, votes, events } = data;
  let segCoords: [number, number][] = [];
  try {
    const parsed = JSON.parse(segment?.coordinatesJson || '[]');
    segCoords = parsed.map((c: number[]) => [c[1], c[0]] as [number, number]);
  } catch {
    segCoords = [];
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button
          onClick={onBack}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
        >
          ← Back to Queue
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleAction('confirm')}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
          >
            Confirm
          </button>
          <button
            onClick={() => handleAction('clear')}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
          >
            Mark Cleared
          </button>
          <button
            onClick={() => handleAction('extend_expiry', { extendHours: 6 })}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold"
          >
            +6h Expiry
          </button>
          <button
            onClick={() => handleAction('expire_now')}
            className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold"
          >
            Expire Now
          </button>
          <button
            onClick={() =>
              onConfirmDestructive('Reject Report', 'Reject this hazard report and hide it from the public map?', () =>
                handleAction('reject', { reason: rejectReason || 'Rejected by admin' })
              )
            }
            className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold"
          >
            Reject
          </button>
          <button
            onClick={() =>
              onConfirmDestructive('Delete Spam Report', 'Permanently delete this report from the database?', async () => {
                await adminApi.deleteHazard(hazardId);
                onNotify('Report permanently deleted');
                onBack();
              })
            }
            className="px-3 py-1.5 rounded-lg bg-rose-900 hover:bg-rose-800 text-rose-200 text-xs font-bold border border-rose-700"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Metadata & Edit */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white capitalize">
              {report.type.replace(/_/g, ' ')} • {report.severity}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700 uppercase">
              {report.status} ({report.source})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 bg-slate-950/70 p-3 rounded-lg border border-slate-800">
            <div><span className="text-slate-500">Road Edge:</span> {segment?.name || report.edgeId || 'Unsnapped'}</div>
            <div><span className="text-slate-500">Edge Status:</span> {segment?.status || 'open'}</div>
            <div><span className="text-slate-500">Votes:</span> +{report.confirmCount} Yes / {report.clearCount} Clear</div>
            <div>
              <span className="text-slate-500">Reporter Score:</span>{' '}
              {report.device?.reliabilityScore?.toFixed(2) ?? '1.00'}
            </div>
            <div><span className="text-slate-500">Reported:</span> {new Date(report.reportedAt).toLocaleString()}</div>
            <div><span className="text-slate-500">Expires:</span> {new Date(report.expiresAt).toLocaleString()}</div>
          </div>

          {report.note && (
            <div className="text-xs text-slate-200 bg-slate-800/60 p-2.5 rounded-lg border border-slate-700">
              <span className="text-slate-400 font-semibold">Note:</span> {report.note}
            </div>
          )}

          {report.photoUrl && (
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs">
              <a href={report.photoUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline truncate">
                {report.photoUrl}
              </a>
              <button
                onClick={() => handleAction('delete_photo')}
                className="px-2 py-1 rounded bg-rose-900 text-rose-200 text-[11px] font-semibold"
              >
                Delete Photo
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Optional rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
            />
            <button
              onClick={() => setEditMode(!editMode)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
            >
              {editMode ? 'Cancel Edit' : 'Edit & Re-snap'}
            </button>
          </div>

          {editMode && (
            <form onSubmit={handleSaveEdit} className="flex flex-col gap-2 bg-slate-950 p-3 rounded-lg border border-slate-700 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <select value={editType} onChange={(e) => setEditType(e.target.value)} className="bg-slate-900 border border-slate-700 rounded p-1.5 text-slate-100">
                  <option value="landslide">Landslide</option>
                  <option value="flooded_road">Flooded Road</option>
                  <option value="fallen_tree">Fallen Tree</option>
                  <option value="damaged_road">Damaged Road</option>
                  <option value="bridge_damaged">Bridge Damaged</option>
                  <option value="road_blocked">Road Blocked</option>
                  <option value="fog">Fog</option>
                  <option value="other">Other</option>
                </select>
                <select value={editSeverity} onChange={(e) => setEditSeverity(e.target.value)} className="bg-slate-900 border border-slate-700 rounded p-1.5 text-slate-100">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Note"
                className="bg-slate-900 border border-slate-700 rounded p-1.5 text-slate-100"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="any"
                  value={editLat}
                  onChange={(e) => setEditLat(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded p-1.5 text-slate-100"
                />
                <input
                  type="number"
                  step="any"
                  value={editLng}
                  onChange={(e) => setEditLng(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded p-1.5 text-slate-100"
                />
              </div>
              <button type="submit" className="py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold">
                Save & Re-snap to Road Edge
              </button>
            </form>
          )}
        </div>

        {/* Right: Snapped Road Map */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden h-[300px]">
          <MapContainer center={[report.lat, report.lng]} zoom={15} className="w-full h-full">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {segCoords.length > 1 && <Polyline positions={segCoords} pathOptions={{ color: '#ef4444', weight: 6 }} />}
            <Marker position={[report.lat, report.lng]} />
          </MapContainer>
        </div>
      </div>

      {/* Votes & Lifecycle Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-100 mb-2">Community Votes ({votes.length})</h3>
          {votes.length === 0 ? (
            <p className="text-xs text-slate-500">No community votes recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-800 text-xs">
              {votes.map((v: any) => (
                <div key={v.id} className="py-2 flex items-center justify-between text-slate-300">
                  <span className="font-mono">{v.deviceShortId}</span>
                  <span className="uppercase font-bold text-emerald-400">{v.vote}</span>
                  <span className="text-slate-400">{v.distanceMeters !== null ? `${v.distanceMeters} m` : 'N/A'}</span>
                  <span className="text-slate-500">{new Date(v.createdAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-100 mb-2">Lifecycle Events ({events.length})</h3>
          {events.length === 0 ? (
            <p className="text-xs text-slate-500">No lifecycle events.</p>
          ) : (
            <div className="divide-y divide-slate-800 text-xs max-h-60 overflow-y-auto">
              {events.map((ev: any) => (
                <div key={ev.id} className="py-2 flex items-center justify-between text-slate-300">
                  <span className="font-semibold text-blue-400">{ev.eventType}</span>
                  <span className="text-slate-500">{new Date(ev.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
