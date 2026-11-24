import React, { useState, useEffect, useRef } from 'react';
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
  const [originQuery, setOriginQuery] = useState(currentOriginName);
  const [destQuery, setDestQuery] = useState(currentDestinationName);
  const [activeField, setActiveField] = useState<'origin' | 'dest' | null>(null);

  const [originSuggestions, setOriginSuggestions] = useState<GeocodeResult[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<GeocodeResult[]>([]);

  const searchTimeout = useRef<any>(null);

  useEffect(() => {
    setOriginQuery(currentOriginName);
  }, [currentOriginName]);

  useEffect(() => {
    setDestQuery(currentDestinationName);
  }, [currentDestinationName]);

  const handleSearch = (text: string, field: 'origin' | 'dest') => {
    if (field === 'origin') setOriginQuery(text);
    else setDestQuery(text);

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (text.trim().length >= 2) {
      searchTimeout.current = setTimeout(async () => {
        try {
          const res = await api.geocode(text.trim());
          if (field === 'origin') {
            setOriginSuggestions(res.results || []);
          } else {
            setDestSuggestions(res.results || []);
          }
        } catch {
          if (field === 'origin') setOriginSuggestions([]);
          else setDestSuggestions([]);
        }
      }, 200);
    } else {
      if (field === 'origin') setOriginSuggestions([]);
      else setDestSuggestions([]);
    }
  };

  const selectPlace = (place: GeocodeResult, field: 'origin' | 'dest') => {
    if (field === 'origin') {
      setOriginQuery(place.name);
      setOriginSuggestions([]);
      setActiveField(null);
      onSelectOrigin({
        name: place.name,
        nodeId: place.node_id,
        lat: place.lat,
        lng: place.lng,
      });
    } else {
      setDestQuery(place.name);
      setDestSuggestions([]);
      setActiveField(null);
      onSelectDestination({
        name: place.name,
        nodeId: place.node_id,
        lat: place.lat,
        lng: place.lng,
      });
    }
  };

  return (
    <div className="absolute top-3 left-3 right-3 sm:left-4 sm:right-auto sm:w-[460px] z-[1100] flex flex-col gap-2 pointer-events-auto">
      {/* Search Container Card */}
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
                Safe Vehicle Router
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
        <div className="flex items-center gap-2 relative">
          <div className="flex-1 flex flex-col gap-1.5">
            {/* Origin Input */}
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-700/70 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500/20 text-xs">
                <span className="text-emerald-400 font-bold text-sm">🟢</span>
                <input
                  type="text"
                  placeholder="Start location / Origin..."
                  value={originQuery}
                  onChange={(e) => handleSearch(e.target.value, 'origin')}
                  onFocus={() => {
                    setActiveField('origin');
                    if (originQuery.length >= 2) handleSearch(originQuery, 'origin');
                  }}
                  className="bg-transparent text-xs text-slate-100 placeholder-slate-400 w-full focus:outline-none font-medium"
                />
                {originQuery && (
                  <button
                    onClick={() => {
                      setOriginQuery('');
                      setOriginSuggestions([]);
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Origin Suggestions Dropdown */}
              {activeField === 'origin' && originSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/98 border border-slate-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-50 divide-y divide-slate-800">
                  {originSuggestions.map((item) => (
                    <div
                      key={`orig-${item.place_id}`}
                      onClick={() => selectPlace(item, 'origin')}
                      className="p-2 hover:bg-slate-800 cursor-pointer flex items-center justify-between text-left text-xs transition"
                    >
                      <span className="font-semibold text-slate-100">{item.name}</span>
                      <span className="text-[10px] text-slate-500">{item.node_id ? 'Road Node' : 'Place'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Destination Input */}
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-700/70 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500/20 text-xs">
                <span className="text-rose-500 font-bold text-sm">🏁</span>
                <input
                  type="text"
                  placeholder="Destination (e.g. Cherrapunji, Dawki)..."
                  value={destQuery}
                  onChange={(e) => handleSearch(e.target.value, 'dest')}
                  onFocus={() => {
                    setActiveField('dest');
                    if (destQuery.length >= 2) handleSearch(destQuery, 'dest');
                  }}
                  className="bg-transparent text-xs text-slate-100 placeholder-slate-400 w-full focus:outline-none font-medium"
                />
                {destQuery && (
                  <button
                    onClick={() => {
                      setDestQuery('');
                      setDestSuggestions([]);
                    }}
                    className="text-slate-400 hover:text-slate-200 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Destination Suggestions Dropdown */}
              {activeField === 'dest' && destSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/98 border border-slate-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto z-50 divide-y divide-slate-800">
                  {destSuggestions.map((item) => (
                    <div
                      key={`dest-${item.place_id}`}
                      onClick={() => selectPlace(item, 'dest')}
                      className="p-2 hover:bg-slate-800 cursor-pointer flex items-center justify-between text-left text-xs transition"
                    >
                      <span className="font-semibold text-slate-100">{item.name}</span>
                      <span className="text-[10px] text-slate-500">{item.node_id ? 'Road Node' : 'Place'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Swap Origin / Destination Button */}
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
          {/* Safest vs Fastest Toggle */}
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

          {/* Find Route Button */}
          <button
            onClick={onSearchRoute}
            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold py-2 px-3 rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 active:scale-95"
          >
            <span>🧭</span>
            <span>Find Safest Route</span>
          </button>
        </div>
      </div>
    </div>
  );
};
