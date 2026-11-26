import React from 'react';
import { DrivingState, IS_DEV_BUILD } from '../hooks/useDrivingNavigation';

interface DrivingNavigationOverlayProps {
  drivingState: DrivingState;
  vehicleName?: string;
  onStopNavigation: () => void;
  onPauseNavigation: () => void;
  onResumeNavigation: () => void;
  onToggleMute: () => void;
  onToggleDemoDrive: () => void;
  onSetSimulationSpeed: (multiplier: number) => void;
  onRecenterMap: () => void;
  onRetryGps: () => void;
}

export const DrivingNavigationOverlay: React.FC<DrivingNavigationOverlayProps> = ({
  drivingState,
  onStopNavigation,
  onPauseNavigation,
  onResumeNavigation,
  onToggleMute,
  onToggleDemoDrive,
  onSetSimulationSpeed,
  onRecenterMap,
  onRetryGps,
}) => {
  const {
    isNavigating,
    isPaused,
    isDemoDrive,
    simulationMultiplier,
    speedKmh,
    currentStep,
    nextStep,
    distanceToTurnM,
    distanceRemainingKm,
    timeRemainingMin,
    arrivalTimestamp,
    upcomingHazard,
    isMuted,
    hasArrived,
    isOffRoute,
    isRerouting,
    wakeLockActive,
    gpsError,
  } = drivingState;

  if (!isNavigating) return null;

  const formatDist = (meters: number) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  };

  const etaTimeStr = new Date(arrivalTimestamp || Date.now() + timeRemainingMin * 60000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-[2000] flex flex-col justify-between p-3 sm:p-5">
      {/* TOP HUD */}
      <div className="w-full max-w-xl mx-auto pointer-events-auto flex flex-col gap-2">
        {hasArrived ? (
          <div className="bg-emerald-950/95 border-2 border-emerald-500 text-white rounded-2xl shadow-2xl p-5 flex flex-col items-center gap-3 backdrop-blur-md">
            <span className="text-4xl">🏁</span>
            <div className="text-center">
              <h2 className="text-lg font-bold text-emerald-200">You have arrived!</h2>
              <p className="text-xs text-emerald-300 mt-1">
                Navigation complete along the verified safest route.
              </p>
            </div>
            <button
              onClick={onStopNavigation}
              className="mt-1 py-2 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-lg transition"
            >
              Finish Navigation
            </button>
          </div>
        ) : (
          <div className="bg-slate-900/95 border border-emerald-500/80 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-md overflow-hidden">
            <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
              {/* Turn Icon */}
              <div className="w-14 h-14 rounded-xl bg-emerald-600 flex items-center justify-center text-3xl shadow-inner text-white flex-shrink-0">
                {currentStep?.maneuverIcon || '⬆️'}
              </div>

              {/* Turn Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400">
                    {formatDist(distanceToTurnM)}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300 truncate">
                    {drivingState.laneHint || 'Continue'}
                  </span>
                </div>

                <div className="text-sm sm:text-base font-bold text-slate-100 truncate mt-0.5">
                  {drivingState.currentTurnInstruction || currentStep?.roadName || 'Continue along route'}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {nextStep && (
                    <span className="text-[10px] text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 truncate max-w-[180px]">
                      Then: {nextStep.maneuverIcon} {nextStep.roadName}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      currentStep?.riskBand === 'Green'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : currentStep?.riskBand === 'Yellow'
                        ? 'bg-amber-950 text-amber-300 border-amber-700'
                        : 'bg-rose-950 text-rose-300 border-rose-700'
                    }`}
                  >
                    {currentStep?.riskBand === 'Green' ? '🟢 Safe' : currentStep?.riskBand === 'Yellow' ? '🟡 Caution' : '🔴 Risky'}{' '}
                    • S={(currentStep?.safetyScore ?? 0.8).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Speed */}
              <div className="flex flex-col items-center justify-center bg-slate-950/80 border border-slate-700/80 rounded-xl px-2.5 py-1.5 min-w-[64px]">
                <span className="text-lg font-black text-slate-100">{speedKmh}</span>
                <span className="text-[9px] uppercase font-bold text-slate-400">km/h</span>
              </div>
            </div>

            {/* GPS Error Banner with Retry */}
            {gpsError && !isDemoDrive && (
              <div className="bg-rose-950/95 border-t border-rose-600/80 px-4 py-2.5 flex items-center justify-between gap-2 text-rose-100 text-xs">
                <div className="flex items-center gap-2">
                  <span>📡</span>
                  <span>{gpsError.message}</span>
                </div>
                <button
                  onClick={onRetryGps}
                  className="px-2.5 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded-lg font-bold flex-shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Off-Route Banner */}
            {(isOffRoute || isRerouting) && (
              <div className="bg-amber-950/95 border-t border-amber-600/80 px-4 py-2 flex items-center gap-2 text-amber-200 text-xs font-semibold">
                <span>⚠️</span>
                <span>
                  {isRerouting
                    ? 'Off route — calculating safer route from your current position...'
                    : 'Off route detected (>40m).'}
                </span>
              </div>
            )}

            {/* Remaining-Route Hazard Look-ahead */}
            {upcomingHazard && (
              <div className="bg-amber-950/90 border-t border-amber-600/70 px-4 py-2 flex items-center gap-2 text-amber-200 text-xs font-semibold">
                <span>⚠️</span>
                <span>
                  {upcomingHazard.hazard.type.replace(/_/g, ' ')} {formatDist(upcomingHazard.distanceAheadM)} ahead on route.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Web Background GPS Limitation Notice */}
        {!hasArrived && (
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl px-3 py-1.5 text-[10px] text-slate-300 flex items-center justify-between gap-2 backdrop-blur-sm">
            <span>
              Keep this tab open and screen on — browsers pause GPS updates in the background.
            </span>
            {wakeLockActive && (
              <span className="text-emerald-400 font-semibold whitespace-nowrap">🔒 Screen Awake</span>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM HUD */}
      <div className="w-full max-w-xl mx-auto pointer-events-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-2 text-xs">
          <div className="flex items-center gap-2">
            {IS_DEV_BUILD ? (
              <button
                onClick={onToggleDemoDrive}
                className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 border ${
                  isDemoDrive
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500'
                    : 'bg-emerald-600/30 text-emerald-300 border-emerald-500'
                }`}
              >
                <span>{isDemoDrive ? '🚗 Demo drive' : '📍 Live GPS'}</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 rounded-lg font-bold bg-emerald-600/30 text-emerald-300 border border-emerald-500">
                📍 Live GPS
              </span>
            )}

            {!isDemoDrive && (
              <span className="text-[10px] text-emerald-400/90 font-medium bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-700/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>GPS: ±{drivingState.accuracyM || 5}m</span>
              </span>
            )}

            {IS_DEV_BUILD && isDemoDrive && (
              <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                {[1, 2, 5].map((mult) => (
                  <button
                    key={mult}
                    onClick={() => onSetSimulationSpeed(mult)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                      simulationMultiplier === mult ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mult}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={isPaused ? onResumeNavigation : onPauseNavigation}
              className="px-2.5 py-1 rounded-lg font-bold border bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>

            <button
              onClick={onToggleMute}
              title={isMuted ? 'Unmute Voice' : 'Mute Voice'}
              className={`p-1.5 rounded-lg border font-bold transition ${
                isMuted ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-emerald-950 text-emerald-300 border-emerald-700'
              }`}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

            <button
              onClick={onRecenterMap}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 border ${
                drivingState.isFollowingCamera
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                  : 'bg-amber-900/80 text-amber-200 border-amber-600 animate-pulse'
              }`}
            >
              <span>🎯</span>
              <span>{drivingState.isFollowingCamera ? 'Centered' : 'Recenter'}</span>
            </button>
          </div>
        </div>

        <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl p-3.5 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-100">{timeRemainingMin}</span>
            <span className="text-xs font-bold text-slate-400 uppercase">min</span>
            <span className="text-xs text-slate-400">• {distanceRemainingKm} km</span>
            <span className="text-xs text-emerald-400 font-semibold">• ETA {etaTimeStr}</span>
          </div>

          <button
            onClick={onStopNavigation}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 flex-shrink-0"
          >
            <span>✕</span>
            <span>Exit</span>
          </button>
        </div>
      </div>
    </div>
  );
};
