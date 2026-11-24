import React from 'react';
import { DrivingState } from '../hooks/useDrivingNavigation';

interface DrivingNavigationOverlayProps {
  drivingState: DrivingState;
  vehicleName?: string;
  onStopNavigation: () => void;
  onToggleMute: () => void;
  onToggleSimulation: () => void;
  onSetSimulationSpeed: (multiplier: number) => void;
  onRecenterMap: () => void;
}

export const DrivingNavigationOverlay: React.FC<DrivingNavigationOverlayProps> = ({
  drivingState,
  vehicleName = 'Car',
  onStopNavigation,
  onToggleMute,
  onToggleSimulation,
  onSetSimulationSpeed,
  onRecenterMap,
}) => {
  const {
    isNavigating,
    isSimulating,
    simulationMultiplier,
    speedKmh,
    currentStep,
    distanceToTurnM,
    distanceRemainingKm,
    timeRemainingMin,
    isMuted,
    hasArrived,
  } = drivingState;

  if (!isNavigating) return null;

  // Format distance
  const formatDist = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  // Format ETA time
  const arrivalDate = new Date(Date.now() + timeRemainingMin * 60000);
  const etaTimeStr = arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="fixed inset-0 pointer-events-none z-[2000] flex flex-col justify-between p-3 sm:p-5">
      {/* TOP HUD: Turn-by-Turn Instruction Banner */}
      <div className="w-full max-w-xl mx-auto pointer-events-auto">
        {hasArrived ? (
          <div className="bg-emerald-950/95 border-2 border-emerald-500 text-white rounded-2xl shadow-2xl p-5 flex flex-col items-center gap-3 backdrop-blur-md animate-bounce-once">
            <span className="text-4xl">🏁</span>
            <div className="text-center">
              <h2 className="text-lg font-bold text-emerald-200">Destination Reached!</h2>
              <p className="text-xs text-emerald-300">
                You have safely arrived at your destination via the verified safest corridor.
              </p>
            </div>
            <button
              onClick={onStopNavigation}
              className="mt-2 py-2 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl shadow-lg transition"
            >
              Finish Navigation
            </button>
          </div>
        ) : (
          <div className="bg-slate-900/95 border border-emerald-500/80 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-md overflow-hidden transition-all">
            {/* Top corridor & maneuver bar */}
            <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
              {/* Turn Icon */}
              <div className="w-14 h-14 rounded-xl bg-emerald-600 flex items-center justify-center text-3xl shadow-inner text-white flex-shrink-0 animate-pulse">
                {currentStep?.maneuverIcon || '⬆️'}
              </div>

              {/* Turn Details & Distance */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-black text-emerald-400">
                    {formatDist(distanceToTurnM)}
                  </span>
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    {currentStep?.maneuver === 'arrive' ? 'To Destination' : 'Next Corridor'}
                  </span>
                </div>

                <div className="text-sm sm:text-base font-bold text-slate-100 truncate mt-0.5">
                  {drivingState.currentTurnInstruction || currentStep?.roadName || 'Continue along route'}
                </div>

                <div className="flex items-center gap-2 mt-1">
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
                    • S={currentStep?.safetyScore.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Step {((currentStep?.index ?? 0) + 1)}
                  </span>
                </div>
              </div>

              {/* Speed & Mode Indicator */}
              <div className="flex flex-col items-center justify-center bg-slate-950/80 border border-slate-700/80 rounded-xl px-2.5 py-1.5 min-w-[64px]">
                <span className="text-lg font-black text-slate-100">{speedKmh}</span>
                <span className="text-[9px] uppercase font-bold text-slate-400">km/h</span>
              </div>
            </div>

            {/* Off-Route Alert Banner */}
            {drivingState.isOffRoute && (
              <div className="bg-rose-950/90 border-t border-rose-600/70 px-4 py-2 flex items-center gap-2 text-rose-200 text-xs font-semibold animate-pulse">
                <span className="text-base">⚠️</span>
                <span>Off-route detected (&gt;40m). Recalculating safest route from current position...</span>
              </div>
            )}

            {/* Hazard Alert Banner (if active hazard on this road) */}
            {currentStep?.hazardAhead && (
              <div className="bg-amber-950/90 border-t border-amber-600/70 px-4 py-2 flex items-center gap-2 text-amber-200 text-xs font-semibold animate-pulse">
                <span className="text-base">⚠️</span>
                <span>
                  Hazard Alert: Active {currentStep.hazardAhead.type.replace('_', ' ')} verified ahead on this corridor. Reduce speed!
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM HUD: Navigation Controls & ETA Bar */}
      <div className="w-full max-w-xl mx-auto pointer-events-auto flex flex-col gap-2">
        {/* Quick Speed & Simulation Controls */}
        <div className="flex items-center justify-between bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleSimulation}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1.5 border ${
                isSimulating
                  ? 'bg-blue-600/30 text-blue-300 border-blue-500'
                  : 'bg-emerald-600/30 text-emerald-300 border-emerald-500'
              }`}
            >
              <span>{isSimulating ? '🚗 Demo Simulation' : '📍 Live GPS Driving'}</span>
            </button>

            {!isSimulating && (
              <span className="text-[10px] text-emerald-400/90 font-medium bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-700/60 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>GPS: ±{drivingState.accuracyM || 5}m</span>
              </span>
            )}

            {isSimulating && (
              <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-slate-800">
                {[1, 2, 5].map((mult) => (
                  <button
                    key={mult}
                    onClick={() => onSetSimulationSpeed(mult)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition ${
                      simulationMultiplier === mult
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mult}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Audio Voice Guidance Toggle */}
            <button
              onClick={onToggleMute}
              title={isMuted ? 'Unmute Voice' : 'Mute Voice'}
              className={`p-1.5 rounded-lg border font-bold transition ${
                isMuted
                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-700'
              }`}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

            {/* Recenter Map Camera */}
            <button
              onClick={onRecenterMap}
              title={drivingState.isFollowingCamera ? 'Camera following vehicle' : 'Recenter camera on vehicle'}
              className={`px-2.5 py-1 rounded-lg font-bold transition flex items-center gap-1 border ${
                drivingState.isFollowingCamera
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                  : 'bg-amber-900/80 text-amber-200 border-amber-600 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]'
              }`}
            >
              <span>🎯</span>
              <span>{drivingState.isFollowingCamera ? 'Centered' : 'Recenter'}</span>
            </button>
          </div>
        </div>

        {/* Main ETA & Exit Card */}
        <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl p-3.5 backdrop-blur-md flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-black text-slate-100">
              {timeRemainingMin}
            </span>
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
