import React, { useState } from 'react';
import { RoutePlanningResponse } from '../types';

interface RouteBottomSheetProps {
  routeResult: RoutePlanningResponse | null;
  selectedRouteRank: number;
  onSelectRoute: (rank: number) => void;
  onHighlightSegment?: (segmentId: string) => void;
  onStartNavigation?: () => void;
  isLoading: boolean;
  onClose: () => void;
}

export const RouteBottomSheet: React.FC<RouteBottomSheetProps> = ({
  routeResult,
  selectedRouteRank,
  onSelectRoute,
  onHighlightSegment,
  onStartNavigation,
  isLoading,
  onClose,
}) => {
  const [showDirections, setShowDirections] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  if (isLoading) {
    return (
      <div className="absolute bottom-4 left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] z-[1100] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl p-4 pointer-events-auto flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-medium text-slate-200">
          Calculating vehicle-safe routes & community hazard passability...
        </span>
      </div>
    );
  }

  if (!routeResult) return null;

  const { routes = [], status, objective, rationale, constraints_applied = [], vehicle } = routeResult;
  const activeRoute = routes.find((r) => r.rank === selectedRouteRank) || routes[0];

  // Voice Speech Guidance ("Tell Me The Route")
  const handleTellRoute = () => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this browser.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const travelHours = Math.floor(activeRoute.estimated_travel_minutes / 60);
    const travelMins = Math.round(activeRoute.estimated_travel_minutes % 60);
    const timePhrase = travelHours > 0 ? `${travelHours} hours and ${travelMins} minutes` : `${travelMins} minutes`;

    const speechText = `Safest route calculated for your ${vehicle.name}. Total distance is ${activeRoute.distance_km} kilometers. Estimated travel time is ${timePhrase}. Overall safety condition is ${activeRoute.safety_band}. ${activeRoute.rationale}. ${activeRoute.bottleneck ? `Caution is advised near ${activeRoute.bottleneck.edge_id} due to ${activeRoute.bottleneck.reason}.` : 'All corridors are clear and passable.'}`;

    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  if (status === 'NO_FEASIBLE_ROUTE' || routes.length === 0) {
    return (
      <div className="absolute bottom-4 left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] z-[1100] bg-slate-900/98 backdrop-blur-md border border-rose-800/80 rounded-2xl shadow-2xl p-4 pointer-events-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-rose-500 text-xl font-bold">⛔</span>
            <span className="font-bold text-slate-100 text-sm">NO SAFE ROUTE FEASIBLE</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1 rounded bg-slate-800">
            ✕
          </button>
        </div>

        <p className="text-xs text-rose-300 font-medium leading-relaxed">
          {rationale || 'All corridor alternatives are closed or pose critical hazards exceeding your vehicle clearance.'}
        </p>

        {constraints_applied.length > 0 && (
          <div className="bg-rose-950/40 border border-rose-900/50 rounded-xl p-2.5 flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-rose-200">Blocking Hazards & Constraints:</span>
            {constraints_applied.slice(0, 3).map((c, i) => (
              <div key={i} className="text-rose-300 text-[11px] flex items-start gap-1">
                <span>•</span>
                <span>{c.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-slate-400 italic">
          💡 Tip: Try switching to a more agile vehicle (e.g. Bike or SUV) or wait for road clearance reports.
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] max-h-[72vh] z-[1100] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl p-3.5 pointer-events-auto flex flex-col gap-2.5 overflow-hidden">
      {/* Top Header: Summary & Voice Guidance button */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-100">
            {routes.length} Route{routes.length > 1 ? 's' : ''} ({vehicle?.name || 'Vehicle'})
          </span>
          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/50">
            {objective === 'fastest' ? '⚡ Fastest' : '🛡️ Safest (Default)'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Tell Route (Voice Button) */}
          <button
            onClick={handleTellRoute}
            title={isSpeaking ? 'Stop speaking' : 'Speak route aloud'}
            className={`text-xs font-bold px-2.5 py-1 rounded-xl flex items-center gap-1.5 transition border ${
              isSpeaking
                ? 'bg-red-600 text-white border-red-400 animate-pulse'
                : 'bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border-indigo-500/50'
            }`}
          >
            <span>{isSpeaking ? '⏹️' : '🔊'}</span>
            <span>{isSpeaking ? 'Stop' : 'Tell Route'}</span>
          </button>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Alternative Route Tabs */}
      <div className="grid grid-cols-3 gap-1.5">
        {routes.map((route) => {
          const isSelected = selectedRouteRank === route.rank;
          return (
            <button
              key={`tab-${route.rank}`}
              onClick={() => onSelectRoute(route.rank)}
              className={`p-2 rounded-xl text-left flex flex-col gap-0.5 transition border ${
                isSelected
                  ? 'bg-blue-600/20 border-blue-500 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {route.is_recommended ? '★ Safest' : `Alt ${route.rank}`}
                </span>
                <span className="text-[10px]">
                  {route.safety_band === 'Green' ? '🟢' : route.safety_band === 'Yellow' ? '🟡' : '🔴'}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-100">
                {Math.round(route.estimated_travel_minutes)} min
              </div>
              <div className="text-[10px] text-slate-400">
                {route.distance_km} km
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Route Details Card */}
      {activeRoute && (
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-2 overflow-y-auto max-h-[46vh] pr-1">
          {/* Status Badge & ETA */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-slate-100">
                {Math.round(activeRoute.estimated_travel_minutes)} min
              </span>
              <span className="text-xs text-slate-400 font-medium">
                ({activeRoute.distance_km} km total)
              </span>
            </div>

            <div
              className={`text-xs font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                activeRoute.safety_band === 'Green'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                  : activeRoute.safety_band === 'Yellow'
                  ? 'bg-amber-950 text-amber-300 border-amber-700'
                  : 'bg-rose-950 text-rose-300 border-rose-700'
              }`}
            >
              <span>{activeRoute.safety_band === 'Green' ? '🟢' : activeRoute.safety_band === 'Yellow' ? '🟡' : '🔴'}</span>
              <span>Safety S={activeRoute.composite_safety_score.toFixed(2)}</span>
            </div>
          </div>

          {/* Start Driving Navigation Primary Button */}
          {onStartNavigation && (
            <button
              onClick={onStartNavigation}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.4)] transition flex items-center justify-center gap-2 border border-emerald-400/30 active:scale-[0.98]"
            >
              <span className="text-base">🚀</span>
              <span>Start Turn-by-Turn Driving Navigation</span>
            </button>
          )}

          {/* Weakest Segment Callout */}
          {activeRoute.bottleneck && (
            <div className="bg-amber-950/40 border border-amber-800/40 rounded-lg p-2 text-amber-200 text-xs flex items-start gap-1.5">
              <span className="text-amber-400 font-bold">⚠️</span>
              <div>
                <span className="font-semibold">Weakest Segment ({activeRoute.bottleneck.edge_id}): </span>
                <span>{activeRoute.bottleneck.reason}</span>
              </div>
            </div>
          )}

          {/* Rationale */}
          <div className="text-xs text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-100">Route Rationale: </span>
            {activeRoute.rationale}
          </div>

          {/* Toggle Step-by-Step Corridor Directions */}
          <button
            onClick={() => setShowDirections(!showDirections)}
            className="w-full mt-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex items-center justify-between border border-slate-700"
          >
            <span>🧭 Step-by-Step Corridor Breakdown ({activeRoute.edges.length} segments)</span>
            <span>{showDirections ? '▲ Hide' : '▼ View'}</span>
          </button>

          {/* Step-by-step segment list */}
          {showDirections && (
            <div className="flex flex-col gap-1.5 pt-1 divide-y divide-slate-800/80">
              {activeRoute.edges.map((edge, idx) => {
                const bandColor =
                  edge.risk_band === 'Green' ? 'text-emerald-400' : edge.risk_band === 'Yellow' ? 'text-amber-400' : 'text-rose-400';
                const bandEmoji =
                  edge.risk_band === 'Green' ? '🟢' : edge.risk_band === 'Yellow' ? '🟡' : '🔴';

                return (
                  <div
                    key={`edge-${edge.edge_id}-${idx}`}
                    onClick={() => onHighlightSegment && onHighlightSegment(edge.edge_id)}
                    className="pt-1.5 pb-1 flex items-start justify-between cursor-pointer hover:bg-slate-900/80 p-1.5 rounded transition"
                  >
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[10px] font-bold mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-xs text-slate-200">{edge.name || edge.edge_id}</span>
                        <span className="text-[10px] text-slate-400">
                          {edge.distance_km} km • Safety S={edge.safety_score.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className={`text-[10px] font-bold ${bandColor} flex items-center gap-1`}>
                      <span>{bandEmoji}</span>
                      <span>{edge.risk_band}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
