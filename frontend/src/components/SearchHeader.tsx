import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeocodeResult } from '../types';
import { api } from '../services/api';

interface SearchHeaderProps {
  onSelectOrigin: (location: { name: string; nodeId?: string; lat?: number; lng?: number }) => void;
  onSelectDestination: (location: { name: string; nodeId?: string; lat?: number; lng?: number }) => void;
  onSwapLocations: () => void;
  selectedVehicle: string;
  onSelectVehicle: (vehicleType: string) => void;
  objective: 'safest' | 'fastest';
  onToggleObjective: (objective: 'safest' | 'fastest') => void;
  currentOriginName: string;
  currentDestinationName: string;
  onUseMyLocation: () => void;
  isLocating: boolean;
  onSearchRoute: () => void;
}

interface FieldState {
  query: string;
  suggestions: GeocodeResult[];
  isOpen: boolean;
  highlightedIndex: number;
}

const VEHICLES = [
  { id: 'bike', label: 'Bike', icon: '🏍️', desc: 'Nimble & lightweight' },
  { id: 'car', label: 'Car', icon: '🚗', desc: 'Standard passenger' },
  { id: 'suv', label: 'SUV/Jeep', icon: '🚙', desc: 'High ground clearance' },
  { id: 'truck', label: 'Truck', icon: '🚛', desc: 'Heavy freight/cargo' },
  { id: 'ambulance', label: 'Ambulance', icon: '🚑', desc: 'Emergency response' },
];

export const SearchHeader: React.FC<SearchHeaderProps> = ({
  onSelectOrigin,
  onSelectDestination,
  onSwapLocations,
  selectedVehicle,
  onSelectVehicle,
  objective,
  onToggleObjective,
  currentOriginName,
  currentDestinationName,
  onUseMyLocation,
  isLocating,
  onSearchRoute,
}) => {
  const [originField, setOriginField] = useState<FieldState>({
    query: currentOriginName,
    suggestions: [],
    isOpen: false,
    highlightedIndex: -1,
  });

  const [destField, setDestField] = useState<FieldState>({
    query: currentDestinationName,
    suggestions: [],
    isOpen: false,
    highlightedIndex: -1,
  });

  // Independent timers, AbortControllers, and request IDs per field
  const originTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originAbortRef = useRef<AbortController | null>(null);
  const destAbortRef = useRef<AbortController | null>(null);
  const originReqIdRef = useRef<number>(0);
  const destReqIdRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOriginField({ query: currentOriginName, suggestions: [], isOpen: false, highlightedIndex: -1 });
  }, [currentOriginName]);

  useEffect(() => {
    setDestField({ query: currentDestinationName, suggestions: [], isOpen: false, highlightedIndex: -1 });
  }, [currentDestinationName]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOriginField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }));
        setDestField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup timers & in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (originTimeoutRef.current) clearTimeout(originTimeoutRef.current);
      if (destTimeoutRef.current) clearTimeout(destTimeoutRef.current);
      originAbortRef.current?.abort();
      destAbortRef.current?.abort();
    };
  }, []);

  const cancelFieldRequests = useCallback((field: 'origin' | 'dest') => {
    if (field === 'origin') {
      if (originTimeoutRef.current) clearTimeout(originTimeoutRef.current);
      originAbortRef.current?.abort();
      originReqIdRef.current += 1;
    } else {
      if (destTimeoutRef.current) clearTimeout(destTimeoutRef.current);
      destAbortRef.current?.abort();
      destReqIdRef.current += 1;
    }
  }, []);

  const handleSearch = (text: string, field: 'origin' | 'dest') => {
    const setField = field === 'origin' ? setOriginField : setDestField;
    const setOtherField = field === 'origin' ? setDestField : setOriginField;
    const timeoutRef = field === 'origin' ? originTimeoutRef : destTimeoutRef;
    const abortRef = field === 'origin' ? originAbortRef : destAbortRef;
    const reqIdRef = field === 'origin' ? originReqIdRef : destReqIdRef;

    // Close the other field's dropdown immediately
    setOtherField((prev) => ({ ...prev, isOpen: false, highlightedIndex: -1 }));
    cancelFieldRequests(field);

    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setField({ query: text, suggestions: [], isOpen: false, highlightedIndex: -1 });
      return;
    }

    setField((prev) => ({ ...prev, query: text, isOpen: true, highlightedIndex: -1 }));
    const reqId = reqIdRef.current;

    timeoutRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await api.geocode(trimmed, controller.signal);
        if (controller.signal.aborted || reqId !== reqIdRef.current) return;
        const results = res.results || [];
        setField((prev) =>
          reqId === reqIdRef.current
            ? { ...prev, suggestions: results, isOpen: results.length > 0, highlightedIndex: -1 }
            : prev
        );
      } catch (err: any) {
        if (err?.name === 'AbortError' || reqId !== reqIdRef.current) return;
        setField((prev) => ({ ...prev, suggestions: [], isOpen: false, highlightedIndex: -1 }));
      }
    }, 200);
  };

  const selectPlace = (place: GeocodeResult, field: 'origin' | 'dest') => {
    cancelFieldRequests(field);
    if (field === 'origin') {
      setOriginField({ query: place.name, suggestions: [], isOpen: false, highlightedIndex: -1 });
      onSelectOrigin({
        name: place.name,
        nodeId: place.node_id,
        lat: place.lat,
        lng: place.lng,
      });
    } else {
      setDestField({ query: place.name, suggestions: [], isOpen: false, highlightedIndex: -1 });
      onSelectDestination({
        name: place.name,
        nodeId: place.node_id,
        lat: place.lat,
        lng: place.lng,
      });
    }
  };

  const closeField = (field: 'origin' | 'dest') => {
    cancelFieldRequests(field);
    if (field === 'origin') {
      setOriginField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }));
    } else {
      setDestField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: 'origin' | 'dest') => {
    const state = field === 'origin' ? originField : destField;
    const setField = field === 'origin' ? setOriginField : setDestField;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeField(field);
      return;
    }

    if (!state.isOpen || state.suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setField((prev) => ({
        ...prev,
        highlightedIndex: prev.highlightedIndex < prev.suggestions.length - 1 ? prev.highlightedIndex + 1 : 0,
      }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setField((prev) => ({
        ...prev,
        highlightedIndex: prev.highlightedIndex > 0 ? prev.highlightedIndex - 1 : prev.suggestions.length - 1,
      }));
    } else if (e.key === 'Enter' && state.highlightedIndex >= 0) {
      e.preventDefault();
      const chosen = state.suggestions[state.highlightedIndex];
      if (chosen) selectPlace(chosen, field);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute top-3 left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] z-[1100] flex flex-col gap-2 pointer-events-auto"
    >
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl p-3 flex flex-col gap-2.5 transition-all">
        {/* App Title & Quick Badges */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-[0_0_12px_rgba(37,99,235,0.6)]">
              🛡️
            </div>
            <div>
              <span className="font-bold text-slate-100 text-sm tracking-wide">RoadSafe AI</span>
              <span className="ml-1.5 text-[10px] uppercase font-semibold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                Global + Regional Hazards
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onUseMyLocation}
              disabled={isLocating}
              title="Use current GPS position"
              className="text-blue-400 hover:text-blue-300 font-medium text-[11px] px-2 py-1 rounded-lg bg-blue-950/60 hover:bg-blue-900/60 border border-blue-800/40 flex items-center gap-1 transition"
            >
              <span>📍</span>
              <span>{isLocating ? 'Locating...' : 'My GPS'}</span>
            </button>
          </div>
        </div>

        {/* Origin & Destination Search Rows with Swap Button */}
        <div className="flex items-center gap-2 relative z-30">
          <div className="flex-1 flex flex-col gap-1.5">
            {/* Origin Input */}
            <div className={`relative ${originField.isOpen ? 'z-50' : 'z-10'}`}>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-700/70 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/20 text-xs">
                <span className="text-emerald-400 font-bold text-sm">🟢</span>
                <input
                  type="text"
                  aria-label="Origin location"
                  placeholder="Start location / Origin..."
                  value={originField.query}
                  onChange={(e) => handleSearch(e.target.value, 'origin')}
                  onFocus={() => setDestField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }))}
                  onBlur={() => closeField('origin')}
                  onKeyDown={(e) => handleKeyDown(e, 'origin')}
                  className="bg-transparent text-xs text-slate-100 placeholder-slate-400 w-full focus:outline-none font-medium"
                />
                {originField.query && (
                  <button
                    type="button"
                    aria-label="Clear origin"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      cancelFieldRequests('origin');
                      setOriginField({ query: '', suggestions: [], isOpen: false, highlightedIndex: -1 });
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {originField.isOpen && originField.suggestions.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Origin suggestions"
                  className="absolute top-full left-0 right-0 mt-1.5 bg-slate-900 border border-slate-600 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] max-h-56 overflow-y-auto z-[1300] divide-y divide-slate-800"
                >
                  {originField.suggestions.map((item, idx) => (
                    <div
                      key={`orig-${item.place_id}`}
                      role="option"
                      aria-selected={idx === originField.highlightedIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectPlace(item, 'origin');
                      }}
                      className={`p-2.5 cursor-pointer flex items-center justify-between text-left text-xs transition ${
                        idx === originField.highlightedIndex
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-900 text-slate-100 hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-semibold text-white truncate pr-2">{item.name}</span>
                      <span
                        className={`text-[10px] font-medium whitespace-nowrap ${
                          item.coverage_zone === 'local_hazard_aware'
                            ? 'text-emerald-400'
                            : item.coverage_zone === 'regional_hazards'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {item.coverage_zone === 'local_hazard_aware'
                          ? 'Local Hazard-Aware'
                          : item.coverage_zone === 'regional_hazards'
                          ? 'Regional Hazards'
                          : 'Ordinary Routing'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Destination Input */}
            <div className={`relative ${destField.isOpen ? 'z-50' : 'z-10'}`}>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-700/70 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500/20 text-xs">
                <span className="text-rose-500 font-bold text-sm">🏁</span>
                <input
                  type="text"
                  aria-label="Destination location"
                  placeholder="Destination (e.g. Cherrapunji, Dawki)..."
                  value={destField.query}
                  onChange={(e) => handleSearch(e.target.value, 'dest')}
                  onFocus={() => setOriginField((prev) => ({ ...prev, isOpen: false, suggestions: [], highlightedIndex: -1 }))}
                  onBlur={() => closeField('dest')}
                  onKeyDown={(e) => handleKeyDown(e, 'dest')}
                  className="bg-transparent text-xs text-slate-100 placeholder-slate-400 w-full focus:outline-none font-medium"
                />
                {destField.query && (
                  <button
                    type="button"
                    aria-label="Clear destination"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      cancelFieldRequests('dest');
                      setDestField({ query: '', suggestions: [], isOpen: false, highlightedIndex: -1 });
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {destField.isOpen && destField.suggestions.length > 0 && (
                <div
                  role="listbox"
                  aria-label="Destination suggestions"
                  className="absolute top-full left-0 right-0 mt-1.5 bg-slate-900 border border-slate-600 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] max-h-56 overflow-y-auto z-[1300] divide-y divide-slate-800"
                >
                  {destField.suggestions.map((item, idx) => (
                    <div
                      key={`dest-${item.place_id}`}
                      role="option"
                      aria-selected={idx === destField.highlightedIndex}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectPlace(item, 'dest');
                      }}
                      className={`p-2.5 cursor-pointer flex items-center justify-between text-left text-xs transition ${
                        idx === destField.highlightedIndex
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-900 text-slate-100 hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-semibold text-white truncate pr-2">{item.name}</span>
                      <span
                        className={`text-[10px] font-medium whitespace-nowrap ${
                          item.coverage_zone === 'local_hazard_aware'
                            ? 'text-emerald-400'
                            : item.coverage_zone === 'regional_hazards'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {item.coverage_zone === 'local_hazard_aware'
                          ? 'Local Hazard-Aware'
                          : item.coverage_zone === 'regional_hazards'
                          ? 'Regional Hazards'
                          : 'Ordinary Routing'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={onSwapLocations}
            title="Swap Origin and Destination"
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 flex items-center justify-center text-sm shadow transition active:scale-95"
          >
            ⇅
          </button>
        </div>

        {/* Vehicle Chip Selector */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium px-0.5">
            <span>MY VEHICLE:</span>
            <span className="text-slate-200 font-semibold capitalize">
              {VEHICLES.find((v) => v.id === selectedVehicle)?.label || selectedVehicle}
            </span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {VEHICLES.map((v) => {
              const isSelected = selectedVehicle === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => onSelectVehicle(v.id)}
                  title={v.desc}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_10px_rgba(37,99,235,0.5)] font-semibold'
                      : 'bg-slate-800/70 text-slate-300 border-slate-700/60 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span>{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Objective Toggle & Action Button */}
        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <div className="flex items-center bg-slate-950/80 p-0.5 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => onToggleObjective('safest')}
              className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                objective === 'safest'
                  ? 'bg-emerald-600 text-white font-semibold shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>🛡️</span> Safest
            </button>
            <button
              onClick={() => onToggleObjective('fastest')}
              className={`px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 ${
                objective === 'fastest'
                  ? 'bg-amber-600 text-white font-semibold shadow-[0_0_8px_rgba(217,119,6,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>⚡</span> Fastest
            </button>
          </div>

          <button
            onClick={onSearchRoute}
            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold py-2 px-3 rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>{objective === 'fastest' ? '⚡' : '🧭'}</span>
            <span>{objective === 'fastest' ? 'Find Fastest Route' : 'Find Safest Route'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
