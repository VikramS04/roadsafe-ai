import React, { useEffect, useState } from 'react';
import { HazardReport } from '../types';
import { api } from '../services/api';

interface HazardConfirmationCardProps {
  hazard: HazardReport | null;
  onClose: () => void;
  userLocation?: { lat: number; lng: number } | null;
  locationError?: string | null;
  onRetryLocation?: () => void;
  onVoteCast: (updatedReport?: HazardReport) => void;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatRelativeTime(isoDate: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / (60 * 1000)));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function getSourceInfo(hazard: HazardReport): { label: string; isOfficial: boolean } {
  if (hazard.source === 'ndma_sachet') return { label: 'Official Alert • NDMA SACHET', isOfficial: true };
  if (hazard.source === 'usgs') return { label: 'Official Alert • USGS Seismic', isOfficial: true };
  if (hazard.source === 'admin') return { label: 'Official Admin Advisory', isOfficial: true };
  if (hazard.isImported) return { label: `Official Feed • ${(hazard.source || 'External').toUpperCase()}`, isOfficial: true };
  return { label: 'Community Driver Report', isOfficial: false };
}

function formatVoteLabel(vote: 'yes' | 'no' | 'cleared'): string {
  if (vote === 'yes') return 'Confirmed (I see this hazard)';
  if (vote === 'no') return 'Disputed (I don’t see this hazard)';
  return 'Cleared (Road is open)';
}

export const HazardConfirmationCard: React.FC<HazardConfirmationCardProps> = ({
  hazard,
  onClose,
  userLocation,
  locationError,
  onRetryLocation,
  onVoteCast,
}) => {
  const [isVoting, setIsVoting] = useState(false);
  const [votedMessage, setVotedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'already_voted' | 'out_of_range' | 'generic' | null>(null);
  const [localHazard, setLocalHazard] = useState<HazardReport | null>(hazard);

  useEffect(() => {
    setLocalHazard(hazard);
    setIsVoting(false);
    setVotedMessage(null);
    setError(null);
    setErrorKind(null);
  }, [hazard?.id]);

  // Keep counts/status synced when parent refreshes hazards list
  useEffect(() => {
    if (hazard && localHazard && hazard.id === localHazard.id) {
      setLocalHazard((prev) => (prev ? { ...prev, ...hazard } : hazard));
    }
  }, [hazard]);

  const activeHazard = localHazard || hazard;
  if (!activeHazard) return null;

  const distanceKm = userLocation
    ? haversineKm(userLocation.lat, userLocation.lng, activeHazard.lat, activeHazard.lng)
    : null;
  const isOutOfRange = distanceKm !== null && distanceKm > 5.5;
  const existingVote = activeHazard.userVote ?? null;
  const sourceInfo = getSourceInfo(activeHazard);

  const handleVote = async (vote: 'yes' | 'no' | 'cleared') => {
    if (!userLocation) {
      setError('Location access is required to vote. Please enable GPS so we can verify you are within 5 km of this hazard.');
      setErrorKind('out_of_range');
      return;
    }

    setIsVoting(true);
    setError(null);
    setErrorKind(null);

    try {
      const res = await api.voteHazard(activeHazard.id, {
        vote,
        voter_latitude: userLocation.lat,
        voter_longitude: userLocation.lng,
      });

      const updated: HazardReport = {
        ...activeHazard,
        ...(res.report || {}),
        status: (res.newStatus as HazardReport['status']) || activeHazard.status,
        confirmCount: res.confirmCount ?? activeHazard.confirmCount,
        disputeCount: res.disputeCount ?? activeHazard.disputeCount ?? 0,
        clearCount: res.clearCount ?? activeHazard.clearCount,
        userVote: vote,
      };
      setLocalHazard(updated);

      if (res.statusChanged) {
        setVotedMessage(`Vote recorded! Hazard status updated to ${res.newStatus.toUpperCase()}.`);
      } else {
        setVotedMessage(`Vote recorded: ${formatVoteLabel(vote)}.`);
      }

      onVoteCast(updated);
    } catch (err: any) {
      if (err?.status === 409 || err?.code === 'ALREADY_VOTED') {
        setError('You have already voted on this hazard from this device.');
        setErrorKind('already_voted');
      } else if (err?.status === 403 || err?.code === 'PROXIMITY_ERROR') {
        setError(err.message || 'You are outside the 5 km proximity radius for this hazard.');
        setErrorKind('out_of_range');
      } else {
        setError(err?.message || 'Voting failed. Please try again.');
        setErrorKind('generic');
      }
    } finally {
      setIsVoting(false);
    }
  };

  const statusBadgeClass =
    activeHazard.status === 'confirmed'
      ? 'bg-rose-950 text-rose-200 border-rose-700'
      : activeHazard.status === 'cleared'
      ? 'bg-emerald-950 text-emerald-200 border-emerald-700'
      : 'bg-amber-950 text-amber-200 border-amber-700';

  const statusLabel =
    activeHazard.status === 'confirmed'
      ? 'Confirmed'
      : activeHazard.status === 'cleared'
      ? 'Cleared'
      : 'Unverified';

  const canVote = Boolean(userLocation) && !isOutOfRange && !existingVote && !isVoting;

  return (
    <section
      aria-label="Hazard details and community voting"
      data-testid="hazard-confirmation-card"
      className="fixed sm:absolute bottom-3 left-3 right-3 sm:bottom-auto sm:top-20 sm:left-auto sm:right-4 sm:w-[400px] max-h-[75vh] overflow-y-auto z-[1350] bg-slate-900/95 backdrop-blur-md border border-amber-500/80 rounded-2xl shadow-2xl p-4 pointer-events-auto flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden="true">⚠️</span>
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-1.5">
              <h2 className="font-bold text-slate-100 text-sm capitalize">
                {activeHazard.type.replace(/_/g, ' ')}
              </h2>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${statusBadgeClass}`}>
                {statusLabel}
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                {activeHazard.severity}
              </span>
            </div>

            <div className="mt-1 flex items-center flex-wrap gap-1.5 text-[11px]">
              <span
                className={`px-1.5 py-0.5 rounded font-semibold border ${
                  sourceInfo.isOfficial
                    ? 'bg-sky-950/80 text-sky-200 border-sky-800'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700'
                }`}
              >
                {sourceInfo.label}
              </span>
              <span className="text-slate-400">
                Reported {formatRelativeTime(activeHazard.reportedAt)} ({new Date(activeHazard.reportedAt).toLocaleString()})
              </span>
            </div>

            {(activeHazard.areaDesc || activeHazard.stateRegion || activeHazard.edgeId) && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                {activeHazard.areaDesc || activeHazard.stateRegion || ''}
                {activeHazard.edgeId ? `Corridor ${activeHazard.edgeId}` : ''}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close hazard details"
          className="text-slate-400 hover:text-slate-100 text-xs px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          ✕
        </button>
      </div>

      {/* Description / Note */}
      {activeHazard.note && (
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200">
          “{activeHazard.note}”
        </div>
      )}

      {/* Community Confirmation Section */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-amber-200 uppercase tracking-wide">
            Community Confirmation
          </span>
          {sourceInfo.isOfficial && (
            <span className="text-[10px] text-sky-300 font-medium">
              Community feedback separate from official source
            </span>
          )}
        </div>

        {/* Current Vote Totals */}
        <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
          <div className="bg-slate-900 border border-slate-800 rounded-lg py-1.5 px-1">
            <div className="font-bold text-rose-300 text-sm" data-testid="confirm-count">
              {activeHazard.confirmCount ?? 0}
            </div>
            <div className="text-slate-400 text-[10px]">Confirmations</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg py-1.5 px-1">
            <div className="font-bold text-slate-200 text-sm" data-testid="dispute-count">
              {activeHazard.disputeCount ?? 0}
            </div>
            <div className="text-slate-400 text-[10px]">Disputes</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-lg py-1.5 px-1">
            <div className="font-bold text-emerald-300 text-sm" data-testid="clear-count">
              {activeHazard.clearCount ?? 0}
            </div>
            <div className="text-slate-400 text-[10px]">Cleared</div>
          </div>
        </div>

        {/* Location / Proximity Status */}
        {!userLocation ? (
          <div className="bg-rose-950/50 border border-rose-800/80 rounded-lg p-2 text-[11px] text-rose-200 flex flex-col gap-1.5">
            <span>
              <strong>Location required to vote:</strong> Voting requires live GPS access to verify you are within 5 km of this hazard.
              {locationError ? ` (${locationError})` : ''}
            </span>
            {onRetryLocation && (
              <button
                type="button"
                onClick={onRetryLocation}
                className="self-start px-2.5 py-1 rounded-md bg-rose-800 hover:bg-rose-700 text-white font-semibold text-[11px] focus:outline-none focus:ring-2 focus:ring-rose-400"
              >
                Enable / Retry Location
              </button>
            )}
          </div>
        ) : isOutOfRange ? (
          <div className="bg-amber-950/60 border border-amber-800/80 rounded-lg p-2 text-[11px] text-amber-200">
            <strong>Out of range ({distanceKm!.toFixed(1)} km away):</strong> You must be within 5 km of this hazard to confirm or dispute it.
          </div>
        ) : (
          <div className="text-[11px] text-emerald-300/90">
            GPS verified: {distanceKm!.toFixed(1)} km away (within 5 km voting radius).
          </div>
        )}

        {/* Existing Vote / Success / Error Feedback */}
        {existingVote && !votedMessage && (
          <div className="p-2 rounded-lg bg-slate-800/90 border border-slate-600 text-slate-200 text-xs text-center font-medium">
            Already voted: {formatVoteLabel(existingVote)}
          </div>
        )}

        {votedMessage && (
          <div className="p-2 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-200 text-xs text-center font-semibold">
            {votedMessage}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className={`p-2 rounded-lg border text-xs text-center ${
              errorKind === 'already_voted'
                ? 'bg-slate-800/95 border-slate-600 text-amber-200'
                : 'bg-rose-950/90 border-rose-700 text-rose-200'
            }`}
          >
            {error}
          </div>
        )}

        {/* Voting Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => handleVote('yes')}
            disabled={!canVote}
            className="py-2 px-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 disabled:bg-rose-950/60 disabled:text-slate-400 text-white text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed shadow focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            <span>👍 Confirm</span>
            <span className="text-[10px] font-normal opacity-90">I see this hazard</span>
          </button>

          <button
            type="button"
            onClick={() => handleVote('no')}
            disabled={!canVote}
            className="py-2 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-slate-100 disabled:text-slate-500 text-xs font-semibold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed border border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <span>👎 Dispute</span>
            <span className="text-[10px] font-normal opacity-90">I don’t see this</span>
          </button>

          <button
            type="button"
            onClick={() => handleVote('cleared')}
            disabled={!canVote}
            className="py-2 px-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-950/60 disabled:text-slate-400 text-white text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed shadow focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <span>🟢 Cleared</span>
            <span className="text-[10px] font-normal opacity-90">Road is open</span>
          </button>
        </div>

        {isVoting && (
          <div className="text-[11px] text-amber-300 text-center animate-pulse">
            Submitting vote...
          </div>
        )}
      </div>
    </section>
  );
};
