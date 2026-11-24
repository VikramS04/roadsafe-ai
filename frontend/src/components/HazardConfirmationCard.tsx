import React, { useState } from 'react';
import { HazardReport } from '../types';
import { api } from '../services/api';

interface HazardConfirmationCardProps {
  hazard: HazardReport | null;
  onClose: () => void;
  userLocation?: { lat: number; lng: number } | null;
  onVoteCast: () => void;
}

export const HazardConfirmationCard: React.FC<HazardConfirmationCardProps> = ({
  hazard,
  onClose,
  userLocation,
  onVoteCast,
}) => {
  const [isVoting, setIsVoting] = useState(false);
  const [votedMessage, setVotedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useNearbySim, setUseNearbySim] = useState(true);

  if (!hazard) return null;

  const handleVote = async (vote: 'yes' | 'no' | 'cleared') => {
    setIsVoting(true);
    setError(null);

    // If using nearby simulation or if userLocation is missing, vote from hazard proximity (~100m offset)
    const voterLat = useNearbySim || !userLocation ? hazard.lat + 0.001 : userLocation.lat;
    const voterLng = useNearbySim || !userLocation ? hazard.lng + 0.001 : userLocation.lng;

    try {
      const res = await api.voteHazard(hazard.id, {
        vote,
        voter_latitude: voterLat,
        voter_longitude: voterLng,
      });

      if (res.statusChanged) {
        setVotedMessage(`Vote recorded! Status updated to ${res.newStatus.toUpperCase()}.`);
      } else {
        setVotedMessage('Vote recorded! Thank you for helping keep roads safe.');
      }

      setTimeout(() => {
        onVoteCast();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Voting failed.');
    } finally {
      setIsVoting(false);
    }
  };

  const timeAgoMin = Math.round((Date.now() - new Date(hazard.reportedAt).getTime()) / (60 * 1000));

  return (
    <div className="absolute top-20 right-3 left-3 sm:left-auto sm:right-4 sm:w-[390px] z-[1200] bg-slate-900/98 backdrop-blur-md border border-amber-500/80 rounded-2xl shadow-2xl p-4 pointer-events-auto flex flex-col gap-2.5 animate-in fade-in duration-150">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚠️</span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-100 text-sm capitalize">
                {hazard.type.replace('_', ' ')}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                  hazard.status === 'confirmed'
                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
              >
                {hazard.status}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Reported {timeAgoMin} min ago {hazard.edgeId ? `on corridor ${hazard.edgeId}` : ''}
            </p>
          </div>
        </div>

        <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xs px-2 py-0.5 rounded bg-slate-800">
          ✕
        </button>
      </div>

      {hazard.note && (
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 italic">
          "{hazard.note}"
        </div>
      )}

      {/* Confirmation prompt */}
      <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl p-2.5 flex flex-col gap-1 text-xs">
        <span className="font-semibold text-amber-200">
          Is this hazard still blocking the road?
        </span>
        <span className="text-[11px] text-amber-300/80">
          3 "Yes" votes confirm it (reroutes traffic). 3 "Cleared" votes clear it.
        </span>

        {/* Local proximity simulator toggle for testing */}
        <label className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-300 cursor-pointer pt-1 border-t border-amber-900/40">
          <input
            type="checkbox"
            checked={useNearbySim}
            onChange={(e) => setUseNearbySim(e.target.checked)}
            className="rounded text-blue-600 focus:ring-0"
          />
          <span>Nearby Local Driver Mode (Passes 5km check)</span>
        </label>
      </div>

      {votedMessage && (
        <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-xs text-center font-semibold">
          {votedMessage}
        </div>
      )}

      {error && (
        <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-700 text-rose-200 text-xs text-center">
          {error}
        </div>
      )}

      {/* 3 Action Buttons */}
      {!votedMessage && (
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <button
            onClick={() => handleVote('yes')}
            disabled={isVoting}
            className="py-2.5 px-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-50 shadow"
          >
            <span>👍 Still There</span>
            <span className="text-[10px] font-normal opacity-80">({hazard.confirmCount} votes)</span>
          </button>

          <button
            onClick={() => handleVote('no')}
            disabled={isVoting}
            className="py-2.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-50 border border-slate-700"
          >
            <span>👎 Not There</span>
            <span className="text-[10px] font-normal opacity-80">Dispute</span>
          </button>

          <button
            onClick={() => handleVote('cleared')}
            disabled={isVoting}
            className="py-2.5 px-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-50 shadow"
          >
            <span>🟢 Cleared</span>
            <span className="text-[10px] font-normal opacity-80">({hazard.clearCount} votes)</span>
          </button>
        </div>
      )}
    </div>
  );
};
