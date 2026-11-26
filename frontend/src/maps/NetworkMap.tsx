import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { RoadGeoJSON, RoadNode, HazardReport, RouteAlternative } from '../types';

// Custom Map Pins using Leaflet DivIcons
const nodeIcon = L.divIcon({
  className: 'custom-node-pin',
  html: `<div style="background-color: #3B82F6; width: 10px; height: 10px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 8px rgba(59,130,246,0.8);"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const originPinIcon = L.divIcon({
  className: 'custom-origin-pin',
  html: `<div style="background-color: #10B981; color: white; font-weight: bold; font-size: 11px; padding: 4px 8px; border-radius: 20px; border: 2px solid #ffffff; box-shadow: 0 0 12px rgba(16,185,129,0.8); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
    <span>🟢</span><span>START</span>
  </div>`,
  iconSize: [60, 24],
  iconAnchor: [30, 24],
});

const destPinIcon = L.divIcon({
  className: 'custom-dest-pin',
  html: `<div style="background-color: #EF4444; color: white; font-weight: bold; font-size: 11px; padding: 4px 8px; border-radius: 20px; border: 2px solid #ffffff; box-shadow: 0 0 12px rgba(239,68,68,0.8); display: flex; align-items: center; gap: 4px; white-space: nowrap;">
    <span>🏁</span><span>FINISH</span>
  </div>`,
  iconSize: [64, 24],
  iconAnchor: [32, 24],
});

const userLocationIcon = (heading: number | null = null) => {
  const hasHeading = heading !== null && heading !== undefined;
  return L.divIcon({
    className: 'custom-user-pin',
    html: `<div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
      ${hasHeading ? `
        <div style="position: absolute; transform: rotate(${heading}deg); transform-origin: 50% 50%; width: 50px; height: 50px; display: flex; justify-content: center; top: -10px; pointer-events: none;">
          <div style="width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 24px solid rgba(59, 130, 246, 0.45); filter: blur(0.5px);"></div>
        </div>
      ` : ''}
      <div style="position: absolute; width: 26px; height: 26px; border-radius: 50%; background: rgba(59,130,246,0.35); animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background: #2563EB; border: 2.5px solid #ffffff; box-shadow: 0 0 12px #2563EB; z-index: 2;"></div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
};

const vehicleCursorIcon = (bearing: number = 0) => {
  return L.divIcon({
    className: 'custom-vehicle-cursor',
    html: `<div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(16,185,129,0.3); animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="transform: rotate(${bearing}deg); transition: transform 0.2s ease-out; width: 34px; height: 34px; border-radius: 50%; background: #059669; border: 3px solid #ffffff; box-shadow: 0 0 16px rgba(16,185,129,0.9); display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: 900;">
        ▲
      </div>
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
};

const weatherPinIcon = (desc: string, rainMm: number) => {
  return L.divIcon({
    className: 'custom-weather-pin',
    html: `<div style="background: rgba(15,23,42,0.85); backdrop-filter: blur(4px); border: 1.5px solid #38BDF8; color: #E0F2FE; font-size: 10px; font-weight: 600; padding: 3px 6px; border-radius: 12px; box-shadow: 0 0 10px rgba(56,189,248,0.4); display: flex; align-items: center; gap: 3px; white-space: nowrap;">
      <span>🌧️</span><span>${rainMm > 0 ? rainMm + 'mm' : desc}</span>
    </div>`,
    iconSize: [60, 20],
    iconAnchor: [30, 10],
  });
};

const getHazardIcon = (type: string, status: string) => {
  const isConfirmed = status === 'confirmed';
  let emoji = '⚠️';
  if (type === 'landslide') emoji = '🪨';
  else if (type === 'flooded_road') emoji = '🌊';
  else if (type === 'fallen_tree') emoji = '🪵';
  else if (type === 'damaged_road') emoji = '🕳️';
  else if (type === 'bridge_damaged') emoji = '🌉';
  else if (type === 'road_blocked') emoji = '⛔';
  else if (type === 'fog') emoji = '🌫️';

  const borderColor = isConfirmed ? '#EF4444' : '#F59E0B';
  const bgColor = isConfirmed ? '#7F1D1D' : '#78350F';

  return L.divIcon({
    className: 'custom-hazard-pin',
    html: `<div style="background-color: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 8px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 15px; box-shadow: 0 0 12px ${borderColor}; cursor: pointer; transform: scale(${isConfirmed ? 1.15 : 1.0});">
      ${emoji}
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
};

interface NetworkMapProps {
  roadsGeoJSON?: RoadGeoJSON | null;
  nodes?: RoadNode[];
  hazards?: HazardReport[];
  activeRoute?: RouteAlternative | null;
  alternativeRoutes?: RouteAlternative[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string) => void;
  onSelectHazard?: (hazard: HazardReport) => void;
  onSelectRoute?: (rank: number) => void;
  onSetOrigin?: (coords: { lat: number; lng: number; name?: string }) => void;
  onSetDestination?: (coords: { lat: number; lng: number; name?: string }) => void;
  onReportHere?: (coords: { lat: number; lng: number }) => void;
  originCoords?: { lat: number; lng: number; name?: string } | null;
  destCoords?: { lat: number; lng: number; name?: string } | null;
  userLocation?: { lat: number; lng: number; heading?: number | null; accuracy?: number | null } | null;
  isFollowingUser?: boolean;
  onUserPan?: () => void;
  isNavigating?: boolean;
  isFollowingCamera?: boolean;
  vehicleCoords?: [number, number] | null;
  vehicleBearing?: number;
  vehicleSpeedKmh?: number;
  showHazards?: boolean;
  showWeather?: boolean;
  weatherRainMm?: number;
  weatherDesc?: string;
  zoom?: number;
  center?: [number, number];
}

function MapEventsHandler({
  onMapClickAction,
  onUserPanAction,
}: {
  onMapClickAction: (latlng: { lat: number; lng: number }) => void;
  onUserPanAction?: () => void;
}) {
  useMapEvents({
    click(e) {
      onMapClickAction({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    dragstart() {
      onUserPanAction?.();
    },
  });
  return null;
}

function RouteBoundsFitter({
  activeRoute,
  isNavigating,
}: {
  activeRoute?: RouteAlternative | null;
  isNavigating?: boolean;
}) {
  const map = useMap();
  const prevRouteIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (!isNavigating && activeRoute?.coordinates && activeRoute.coordinates.length >= 2) {
      const routeKey = `${activeRoute.rank}-${activeRoute.distance_km}`;
      if (prevRouteIdRef.current !== routeKey) {
        prevRouteIdRef.current = routeKey;
        const latlngs = activeRoute.coordinates.map((c) => [c[1], c[0]] as [number, number]);
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
      }
    }
  }, [activeRoute, isNavigating, map]);
  return null;
}

function CameraFollower({
  isNavigating,
  vehicleCoords,
  isFollowingCamera,
  userLocation,
  isFollowingUser,
}: {
  isNavigating?: boolean;
  vehicleCoords?: [number, number] | null;
  isFollowingCamera?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  isFollowingUser?: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (isNavigating && vehicleCoords && isFollowingCamera !== false) {
      map.panTo(vehicleCoords, { animate: true, duration: 0.5 });
      if (map.getZoom() < 15) {
        map.setZoom(16, { animate: true });
      }
    } else if (!isNavigating && userLocation && isFollowingUser) {
      map.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.5 });
    }
  }, [isNavigating, vehicleCoords, isFollowingCamera, userLocation, isFollowingUser, map]);
  return null;
}

function MapCenterController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export const NetworkMap: React.FC<NetworkMapProps> = ({
  roadsGeoJSON,
  nodes = [],
  hazards = [],
  activeRoute = null,
  alternativeRoutes = [],
  selectedSegmentId = null,
  onSelectSegment,
  onSelectHazard,
  onSelectRoute,
  onSetOrigin,
  onSetDestination,
  onReportHere,
  originCoords = null,
  destCoords = null,
  userLocation = null,
  isFollowingUser = false,
  onUserPan,
  isNavigating = false,
  isFollowingCamera = true,
  vehicleCoords = null,
  vehicleBearing = 0,
  vehicleSpeedKmh = 0,
  showHazards = true,
  showWeather = false,
  weatherRainMm = 0,
  weatherDesc = 'Clear',
  zoom = 10,
  center = [25.40, 91.85],
}) => {
  const [clickedPoint, setClickedPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [tileErrorCount, setTileErrorCount] = useState(0);

  const getSegmentColor = (props: any) => {
    if (selectedSegmentId === props.id) return '#38BDF8';
    if (props.status === 'closed' || props.status === 'blocked') return '#64748B';
    if (props.risk_band === 'Red' || props.landslide_risk > 0.4) return '#EF4444';
    if (props.risk_band === 'Yellow' || props.rainfall_norm > 0.4) return '#F59E0B';
    return '#10B981';
  };

  const handleMapClick = (latlng: { lat: number; lng: number }) => {
    setClickedPoint(latlng);
  };

  // Convert active route coordinates to Leaflet [lat, lng] format
  const activeLatLngs = activeRoute?.coordinates?.map((c) => [c[1], c[0]] as [number, number]) || [];

  return (
    <div className="relative w-full h-full bg-[#0B1120]">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%', background: '#0F172A' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={18}
          eventHandlers={{
            tileerror: () => setTileErrorCount((c) => c + 1),
            tileload: () => setTileErrorCount(0),
          }}
        />

        <MapEventsHandler onMapClickAction={handleMapClick} onUserPanAction={onUserPan} />
        <RouteBoundsFitter activeRoute={activeRoute} isNavigating={isNavigating} />
        <CameraFollower
          isNavigating={isNavigating}
          vehicleCoords={vehicleCoords}
          isFollowingCamera={isFollowingCamera}
          userLocation={userLocation}
          isFollowingUser={isFollowingUser}
        />
        <MapCenterController center={center} zoom={zoom} />

        {/* 1. Underlying Road Network Segments */}
        {roadsGeoJSON?.features.map((feature) => {
          const coords = feature.geometry.coordinates.map((c) => [c[1], c[0]] as [number, number]);
          const props = feature.properties;
          const isSelected = selectedSegmentId === props.id;
          const color = getSegmentColor(props);

          return (
            <Polyline
              key={props.id}
              positions={coords}
              pathOptions={{
                color,
                weight: isSelected ? 7 : 3.5,
                opacity: isSelected ? 0.95 : 0.6,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              eventHandlers={{
                click: () => onSelectSegment && onSelectSegment(props.id),
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1.5 text-slate-900 text-xs flex flex-col gap-1">
                  <div className="font-bold text-sm text-slate-950">{props.name}</div>
                  <div className="text-[11px] text-slate-600">Corridor ID: {props.id}</div>
                  <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                    <span>Risk Status:</span>
                    <span
                      style={{
                        color:
                          props.risk_band === 'Green' ? '#059669' : props.risk_band === 'Yellow' ? '#D97706' : '#DC2626',
                      }}
                    >
                      {props.risk_band === 'Green' ? '🟢 Safe' : props.risk_band === 'Yellow' ? '🟡 Caution' : '🔴 High Hazard'}
                    </span>
                  </div>
                  <div className="text-slate-700">Length: {props.distance_km} km | Travel: {props.travel_time_min} min</div>
                  <div className="text-slate-700">Usable Width: {props.width_m} m | Max Weight: {props.max_weight_kg / 1000} T</div>
                  {props.active_hazards && props.active_hazards.length > 0 && (
                    <div className="mt-1 p-1 bg-red-100 text-red-800 rounded font-bold text-[11px] border border-red-300">
                      ⚠️ {props.active_hazards.length} Active Hazard(s) reported on this segment
                    </div>
                  )}
                </div>
              </Popup>
            </Polyline>
          );
        })}

        {/* 2. Alternative Routes (Dashed translucent lines, clickable to select) */}
        {alternativeRoutes.map((route) => {
          if (activeRoute && route.rank === activeRoute.rank) return null;
          const latlngs = route.coordinates.map((c) => [c[1], c[0]] as [number, number]);
          return (
            <Polyline
              key={`alt-route-${route.rank}`}
              positions={latlngs}
              pathOptions={{
                color: '#94A3B8',
                weight: 5,
                dashArray: '8, 8',
                opacity: 0.7,
              }}
              eventHandlers={{
                click: () => onSelectRoute && onSelectRoute(route.rank),
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1 text-slate-900 text-xs">
                  <div className="font-bold text-sm">Route Alternative {route.rank}</div>
                  <div>ETA: {Math.round(route.estimated_travel_minutes)} min ({route.distance_km} km)</div>
                  <div className="font-semibold text-blue-700">Click to switch to this route</div>
                </div>
              </Popup>
            </Polyline>
          );
        })}

        {/* 3. Active Chosen Route (Glowing prominent polyline with arrows) */}
        {activeLatLngs.length >= 2 && (
          <>
            {/* Outer Glow Halo */}
            <Polyline
              positions={activeLatLngs}
              pathOptions={{
                color: activeRoute?.safety_band === 'Green' ? '#10B981' : activeRoute?.safety_band === 'Yellow' ? '#F59E0B' : '#EF4444',
                weight: 12,
                opacity: 0.35,
              }}
            />
            {/* Core Route Line */}
            <Polyline
              positions={activeLatLngs}
              pathOptions={{
                color: activeRoute?.safety_band === 'Green' ? '#059669' : activeRoute?.safety_band === 'Yellow' ? '#D97706' : '#DC2626',
                weight: 6,
                opacity: 0.95,
              }}
            >
              <Popup className="custom-popup">
                <div className="p-1.5 text-slate-900 text-xs">
                  <div className="font-bold text-sm">
                    {activeRoute?.is_recommended ? '★ SAFEST RECOMMENDED ROUTE' : `ROUTE ALTERNATIVE ${activeRoute?.rank}`}
                  </div>
                  <div>Travel Time: {Math.round(activeRoute?.estimated_travel_minutes || 0)} min</div>
                  <div>Total Distance: {activeRoute?.distance_km} km</div>
                  <div className="font-semibold text-emerald-700">Safety Index: {activeRoute?.composite_safety_score.toFixed(2)}</div>
                </div>
              </Popup>
            </Polyline>
          </>
        )}

        {/* 4. Origin (Start) & Destination (Finish) Pins */}
        {originCoords && (
          <Marker position={[originCoords.lat, originCoords.lng]} icon={originPinIcon}>
            <Popup className="custom-popup">
              <div className="p-1 text-slate-900 text-xs font-bold">Start: {originCoords.name || 'Origin'}</div>
            </Popup>
          </Marker>
        )}

        {destCoords && (
          <Marker position={[destCoords.lat, destCoords.lng]} icon={destPinIcon}>
            <Popup className="custom-popup">
              <div className="p-1 text-slate-900 text-xs font-bold">Finish: {destCoords.name || 'Destination'}</div>
            </Popup>
          </Marker>
        )}

        {/* 5. Road Network Nodes */}
        {nodes.map((node) => (
          <Marker
            key={node.id}
            position={[node.lat, node.lng]}
            icon={nodeIcon}
          >
            <Popup className="custom-popup">
              <div className="p-1 text-slate-900 text-xs">
                <div className="font-bold text-sm">{node.name}</div>
                <div className="text-[11px] text-slate-500">ID: {node.id} | Elev: {node.elevationM} m</div>
                <div className="flex items-center gap-1 mt-1.5">
                  <button
                    onClick={() => onSetOrigin && onSetOrigin({ lat: node.lat, lng: node.lng, name: node.name })}
                    className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold"
                  >
                    Set Origin
                  </button>
                  <button
                    onClick={() => onSetDestination && onSetDestination({ lat: node.lat, lng: node.lng, name: node.name })}
                    className="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-semibold"
                  >
                    Set Destination
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* 6. Live Weather Radar Indicators along corridor when showWeather is ON */}
        {showWeather &&
          nodes.filter((_, idx) => idx % 2 === 0).map((node) => (
            <Marker
              key={`weather-node-${node.id}`}
              position={[node.lat + 0.015, node.lng + 0.015]}
              icon={weatherPinIcon(weatherDesc, weatherRainMm)}
            />
          ))}

        {/* 7. Hazard Markers & Imported Alert Area Polygons */}
        {showHazards &&
          hazards.map((hazard) => {
            let polyPositions: [number, number][] | null = null;
            if (hazard.geometryJson) {
              try {
                const geo = JSON.parse(hazard.geometryJson);
                if (geo?.type === 'Polygon' && Array.isArray(geo.coordinates?.[0])) {
                  polyPositions = geo.coordinates[0].map((c: number[]) => [c[1], c[0]] as [number, number]);
                }
              } catch {
                polyPositions = null;
              }
            }
            const sourceLabel =
              hazard.source === 'ndma_sachet'
                ? 'NDMA SACHET'
                : hazard.source === 'usgs'
                ? 'USGS Seismic'
                : hazard.source === 'admin'
                ? 'Official Admin'
                : 'Community Report';

            return (
              <React.Fragment key={hazard.id}>
                {polyPositions && polyPositions.length >= 3 && (
                  <Polygon
                    positions={polyPositions}
                    pathOptions={{
                      color: hazard.severity === 'critical' ? '#ef4444' : '#f59e0b',
                      fillOpacity: 0.14,
                      weight: 2,
                      dashArray: '4 4',
                    }}
                  />
                )}
                <Marker
                  position={[hazard.lat, hazard.lng]}
                  icon={getHazardIcon(hazard.type, hazard.status)}
                  eventHandlers={{
                    click: () => onSelectHazard && onSelectHazard(hazard),
                  }}
                >
                  <Popup className="custom-popup">
                    <div className="p-1.5 text-slate-900 text-xs flex flex-col gap-1">
                      <div className="font-bold text-sm capitalize">
                        {hazard.type.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[10px] font-bold uppercase text-blue-700">
                        Source: {sourceLabel} {hazard.stateRegion ? `• ${hazard.stateRegion}` : ''}
                      </div>
                      <div className="text-[11px] font-semibold text-rose-700 uppercase">
                        Status: {hazard.status} ({hazard.confirmCount} confirmations)
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Reported: {new Date(hazard.reportedAt).toLocaleString()}
                      </div>
                      {hazard.note && <div className="italic text-slate-700">"{hazard.note}"</div>}
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}

        {/* 8. User Current GPS Location (pulsing dot with optional heading cone) */}
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userLocationIcon(userLocation.heading ?? null)}
            zIndexOffset={isNavigating ? 400 : 900}
          >
            <Popup className="custom-popup">
              <div className="p-1 text-slate-900 text-xs font-bold">
                📍 Your Current GPS Location {userLocation.accuracy ? `(±${userLocation.accuracy}m)` : ''}
              </div>
            </Popup>
          </Marker>
        )}

        {/* 8b. Live Driving Navigation Vehicle Marker */}
        {isNavigating && vehicleCoords && (
          <Marker
            position={vehicleCoords}
            icon={vehicleCursorIcon(vehicleBearing || 0)}
            zIndexOffset={1000}
          >
            <Popup className="custom-popup">
              <div className="p-1 text-slate-900 text-xs font-bold">
                🚗 Vehicle Tracking ({vehicleSpeedKmh} km/h)
              </div>
            </Popup>
          </Marker>
        )}

        {/* 9. Interactive Map Click Popup */}
        {clickedPoint && (
          <Popup
            position={[clickedPoint.lat, clickedPoint.lng]}
            eventHandlers={{
              remove: () => setClickedPoint(null),
            }}
            className="custom-popup"
          >
            <div className="p-1.5 text-slate-900 text-xs flex flex-col gap-1.5">
              <div className="font-bold text-xs text-slate-900">Map Point Selected</div>
              <div className="text-[10px] text-slate-500">
                {clickedPoint.lat.toFixed(4)}, {clickedPoint.lng.toFixed(4)}
              </div>
              <div className="grid grid-cols-2 gap-1 pt-1">
                <button
                  onClick={() => {
                    onSetOrigin && onSetOrigin({ lat: clickedPoint.lat, lng: clickedPoint.lng, name: 'Tapped Point' });
                    setClickedPoint(null);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 px-1.5 rounded text-[10px]"
                >
                  🟢 Set Origin
                </button>
                <button
                  onClick={() => {
                    onSetDestination && onSetDestination({ lat: clickedPoint.lat, lng: clickedPoint.lng, name: 'Tapped Destination' });
                    setClickedPoint(null);
                  }}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-1 px-1.5 rounded text-[10px]"
                >
                  🏁 Set Destination
                </button>
              </div>
              <button
                onClick={() => {
                  onReportHere && onReportHere(clickedPoint);
                  setClickedPoint(null);
                }}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 px-2 rounded text-[10px]"
              >
                ⚠️ Report Hazard Here
              </button>
            </div>
          </Popup>
        )}
      </MapContainer>

      {/* Non-blocking Tile Loading Warning */}
      {tileErrorCount >= 4 && (
        <div className="absolute bottom-3 left-3 z-[1050] bg-amber-950/90 border border-amber-700 text-amber-200 text-[11px] px-3 py-1.5 rounded-lg shadow-lg pointer-events-auto">
          Map tiles temporarily unavailable or rate-limited; routes and hazard markers remain active.
        </div>
      )}
    </div>
  );
};
