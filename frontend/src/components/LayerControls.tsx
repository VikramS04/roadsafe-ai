import React from 'react';
import { ConditionsResponse } from '../types';

interface LayerControlsProps {
  showHazards: boolean;
  onToggleHazards: () => void;
  showWeather: boolean;
  onToggleWeather: () => void;
  conditions: ConditionsResponse | null;
  onCenterLocation: () => void;
  onOpenReport: () => void;
  isFollowingLocation?: boolean;
}

export const LayerControls: React.FC<LayerControlsProps> = ({
  showHazards,
  onToggleHazards,
  showWeather,
  onToggleWeather,
  conditions,
  onCenterLocation,
  onOpenReport,
  isFollowingLocation = false,
}) => {
  const weather = conditions?.weather;
  const alert = conditions?.alerts?.[0];

  return (
    <div className="absolute bottom-5 right-4 z-[1050] flex flex-col items-end gap-2.5 pointer-events-auto">
      {/* Official Weather Alert Pill if present */}
      {alert && (
        <div className="bg-rose-950/90 backdrop-blur-md border border-rose-800/80 rounded-xl p-2.5 shadow-xl max-w-xs text-xs text-rose-200 flex items-start gap-2 animate-in fade-in">
          <span className="text-base">📢</span>
          <div>
            <span className="font-bold text-rose-100">{alert.headline}</span>
            <p className="text-[11px] text-rose-300 line-clamp-2">{alert.description}</p>
          </div>
        </div>
      )}

      {/* Floating Action Button: Report a Hazard (2-tap) */}
      <button
        onClick={onOpenReport}
        className="bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold py-3 px-4 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.5)] border border-red-400/40 flex items-center gap-2 text-sm active:scale-95 transition"
      >
        <span className="text-lg">⚠️</span>
        <span className="tracking-wide">Report Hazard</span>
      </button>

      {/* Control Buttons Group */}
      <div className="flex flex-col gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-1.5 shadow-xl">
        {/* Hazards Layer Toggle */}
        <button
          onClick={onToggleHazards}
          title="Toggle Hazard Markers"
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-base transition border ${
            showHazards
              ? 'bg-amber-600/30 border-amber-500 text-amber-300 shadow-[0_0_8px_rgba(217,119,6,0.3)]'
              : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          ⚠️
        </button>

        {/* Weather / Rain Layer Toggle */}
        <button
          onClick={onToggleWeather}
          title={
            weather
              ? weather.unavailable
                ? 'Weather data unavailable'
                : `${weather.conditionDescription} (${weather.currentRainMm ?? 0}mm rain) • ${weather.source || 'Open-Meteo'}${weather.fetchedAt ? ` @ ${new Date(weather.fetchedAt).toLocaleTimeString()}` : ''}${weather.isStale ? ' (Stale)' : ''}`
              : 'Toggle Weather Layer'
          }
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-base transition border ${
            showWeather
              ? weather?.unavailable
                ? 'bg-slate-800/80 border-slate-600 text-slate-400'
                : 'bg-blue-600/30 border-blue-500 text-blue-300 shadow-[0_0_8px_rgba(37,99,235,0.3)]'
              : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          {weather?.unavailable ? '☁️' : '🌧️'}
        </button>

        {/* Center Location (Google Maps style Follow Me) */}
        <button
          onClick={onCenterLocation}
          title={isFollowingLocation ? 'Camera following live GPS' : 'Center on My Location'}
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-base transition border ${
            isFollowingLocation
              ? 'bg-blue-600/40 border-blue-400 text-blue-200 shadow-[0_0_14px_rgba(37,99,235,0.8)]'
              : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60 text-slate-300 hover:text-white'
          }`}
        >
          <span className={isFollowingLocation ? 'animate-pulse' : ''}>📍</span>
        </button>
      </div>
    </div>
  );
};
