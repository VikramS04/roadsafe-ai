import React, { useState } from 'react';
import { api } from '../services/api';

interface ReportHazardModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultLocation: { lat: number; lng: number };
  onReportCreated: () => void;
}

const HAZARD_TYPES = [
  { id: 'landslide', label: 'Landslide', icon: '🪨', severity: 'high' },
  { id: 'flooded_road', label: 'Flooded Road', icon: '🌊', severity: 'high' },
  { id: 'fallen_tree', label: 'Fallen Tree', icon: '🪵', severity: 'medium' },
  { id: 'damaged_road', label: 'Damaged / Pothole', icon: '🕳️', severity: 'medium' },
  { id: 'bridge_damaged', label: 'Bridge Damaged', icon: '🌉', severity: 'critical' },
  { id: 'road_blocked', label: 'Road Blocked', icon: '⛔', severity: 'critical' },
  { id: 'fog', label: 'Fog / Low Visibility', icon: '🌫️', severity: 'low' },
  { id: 'other', label: 'Other Hazard', icon: '⚠️', severity: 'medium' },
];

export const ReportHazardModal: React.FC<ReportHazardModalProps> = ({
  isOpen,
  onClose,
  defaultLocation,
  onReportCreated,
}) => {
  const [selectedType, setSelectedType] = useState('landslide');
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const hazardMeta = HAZARD_TYPES.find((h) => h.id === selectedType);

    try {
      await api.reportHazard({
        type: selectedType,
        severity: hazardMeta?.severity || 'medium',
        latitude: defaultLocation.lat,
        longitude: defaultLocation.lng,
        note: note.trim() || undefined,
        photo_url: photoUrl.trim() || undefined,
      });

      onReportCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-md p-4 flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">Report a Road Hazard</h3>
              <p className="text-[11px] text-slate-400">
                Snaps automatically to nearest road edge ({defaultLocation.lat.toFixed(4)}, {defaultLocation.lng.toFixed(4)})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1 rounded bg-slate-800">
            ✕
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 2-Tap Hazard Type Picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Tap 1: Choose Hazard Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {HAZARD_TYPES.map((h) => {
                const isSelected = selectedType === h.id;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setSelectedType(h.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition ${
                      isSelected
                        ? 'bg-blue-600/30 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)] ring-1 ring-blue-500'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="text-lg">{h.icon}</span>
                    <span className="text-xs font-medium leading-tight">{h.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Note */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-400">
              Optional Note / Detail:
            </label>
            <input
              type="text"
              placeholder="e.g. Rocks blocking right lane, water depth ~30cm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-slate-950/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
            />
          </div>

          {/* Action Buttons: Tap 2 Submit */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg transition active:scale-95 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Tap 2: Submit Hazard Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
