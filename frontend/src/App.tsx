import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NetworkMap } from './maps/NetworkMap';
import { SearchHeader } from './components/SearchHeader';
import { RouteBottomSheet } from './components/RouteBottomSheet';
import { ReportHazardModal } from './components/ReportHazardModal';
import { HazardConfirmationCard } from './components/HazardConfirmationCard';
import { LayerControls } from './components/LayerControls';
import { useDrivingNavigation } from './hooks/useDrivingNavigation';
import { useLiveLocation } from './hooks/useLiveLocation';
import { DrivingNavigationOverlay } from './components/DrivingNavigationOverlay';
import { api } from './services/api';
import {
  RoadGeoJSON,
  RoadNode,
  HazardReport,
  ConditionsResponse,
  RoutePlanningResponse,
  RouteAlternative,
} from './types';

export const App: React.FC = () => {
  // Navigation State
  const [origin, setOrigin] = useState<{ name: string; nodeId?: string; lat?: number; lng?: number }>({
    name: 'Shillong (Police Bazar)',
    lat: 25.5788,
    lng: 91.8933,
  });
  const [destination, setDestination] = useState<{ name: string; nodeId?: string; lat?: number; lng?: number }>({
    name: 'Cherrapunji (Sohra)',
    lat: 25.2815,
    lng: 91.7166,
  });

  const [vehicle, setVehicle] = useState<string>(() => {
    return localStorage.getItem('roadsafe_vehicle') || 'car';
  });

  const [objective, setObjective] = useState<'safest' | 'fastest'>('safest');

  // GIS Data
  const [roadsGeoJSON, setRoadsGeoJSON] = useState<RoadGeoJSON | null>(null);
  const [nodes, setNodes] = useState<RoadNode[]>([]);
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [conditions, setConditions] = useState<ConditionsResponse | null>(null);

  // Live GPS Geolocation Engine (Google Maps style)
  const { locationState, startTracking, stopTracking, setFollowing } = useLiveLocation();

  // User GPS
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Sync live GPS updates to userLocation and update Origin if set to My GPS
  useEffect(() => {
    startTracking();
  }, [startTracking]);

  useEffect(() => {
    if (locationState.coords) {
      const coords = locationState.coords;
      setUserLocation(coords);

      // If origin is currently set to live GPS, keep it dynamically locked to current position
      if (origin.name.includes('GPS') || origin.name.includes('Location')) {
        setOrigin((prev) => ({
          ...prev,
          lat: coords.lat,
          lng: coords.lng,
        }));
      }
    }
  }, [locationState.coords, origin.name]);

  // Active Route Calculation
  const [routeResult, setRouteResult] = useState<RoutePlanningResponse | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedRouteRank, setSelectedRouteRank] = useState<number>(1);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

  // UI Layers & Modals
  const [showHazards, setShowHazards] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  const [selectedHazard, setSelectedHazard] = useState<HazardReport | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportCoords, setReportCoords] = useState<{ lat: number; lng: number }>({
    lat: 25.40,
    lng: 91.85,
  });

  // Map center & zoom
  const [mapCenter, setMapCenter] = useState<[number, number]>([25.40, 91.85]);
  const [mapZoom, setMapZoom] = useState<number>(10);

  // Turn-by-Turn GPS Driving Engine
  const {
    drivingState,
    startNavigation,
    stopNavigation,
    toggleMute,
    toggleSimulation,
    setSimulationMultiplier,
    toggleFollowCamera,
  } = useDrivingNavigation();

  const handleStartNavigation = () => {
    const activeRoute = routeResult?.routes?.find((r) => r.rank === selectedRouteRank) || routeResult?.routes?.[0];
    if (activeRoute) {
      // If user has active GPS coordinates, start in Live GPS Driving mode; otherwise demo simulation
      const hasLiveGps = locationState.coords !== null;
      startNavigation(activeRoute, hazards, !hasLiveGps);
    }
  };

  const handleRecenterMap = () => {
    toggleFollowCamera(true);
    if (drivingState.currentCoords) {
      setMapCenter([drivingState.currentCoords[0], drivingState.currentCoords[1]]);
      setMapZoom(16);
    }
  };

  const initialRouteComputed = useRef(false);

  // Plan Route calculation
  const triggerRoutePlan = useCallback(
    async (
      from = origin,
      to = destination,
      v = vehicle,
      obj = objective
    ) => {
      if (!to.name) return;
      setIsLoadingRoutes(true);
      setRouteError(null);
      try {
        const res = await api.planRoute({
          origin: from.lat !== undefined && from.lng !== undefined
            ? { lat: from.lat, lng: from.lng }
            : { nodeId: from.nodeId },
          destination: to.lat !== undefined && to.lng !== undefined
            ? { lat: to.lat, lng: to.lng }
            : { nodeId: to.nodeId },
          vehicle: v,
          objective: obj,
          k: 3,
        });

        if (res.status === 'NO_FEASIBLE_ROUTE') {
          setRouteError('No passable road route available for this vehicle under current road hazards.');
        } else {
          setRouteResult(res);
          setSelectedRouteRank(1);
        }

        if (res.routes?.[0]?.coordinates?.length) {
          const midIdx = Math.floor(res.routes[0].coordinates.length / 2);
          const mid = res.routes[0].coordinates[midIdx];
          if (mid) setMapCenter([mid[1], mid[0]]);
        }
      } catch (err: any) {
        console.error('Route planning failed:', err);
        setRouteError(err.message || 'Routing calculation failed. Please pick a point closer to a drivable road.');
      } finally {
        setIsLoadingRoutes(false);
      }
    },
    [origin, destination, vehicle, objective]
  );

  // Load GIS data & auto-calculate initial route
  const loadData = useCallback(async () => {
    try {
      const [roadsData, nodesData, hazardsData, conditionsData] = await Promise.all([
        api.getRoadsGeoJSON().catch(() => null),
        api.getNodes().catch(() => ({ data: [] })),
        api.getHazards().catch(() => ({ hazards: [] })),
        api.getConditions().catch(() => null),
      ]);

      if (roadsData) setRoadsGeoJSON(roadsData);
      if (nodesData?.data) setNodes(nodesData.data);
      if (hazardsData?.hazards) setHazards(hazardsData.hazards);
      if (conditionsData) setConditions(conditionsData);

      // Auto-compute route on first load so user immediately sees route on map
      if (!initialRouteComputed.current) {
        initialRouteComputed.current = true;
        triggerRoutePlan();
      }
    } catch (err) {
      console.warn('Initial data fetch warning:', err);
    }
  }, [triggerRoutePlan]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 45000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Handle vehicle change
  const handleSelectVehicle = (v: string) => {
    setVehicle(v);
    localStorage.setItem('roadsafe_vehicle', v);
    triggerRoutePlan(origin, destination, v, objective);
  };

  // Swap Origin and Destination
  const handleSwapLocations = () => {
    const prevOrigin = origin;
    const prevDest = destination;
    setOrigin(prevDest);
    setDestination(prevOrigin);
    triggerRoutePlan(prevDest, prevOrigin, vehicle, objective);
  };

  // GPS "Use My Location" (Google Maps style)
  const handleUseMyLocation = () => {
    startTracking();
    setFollowing(true);

    if (locationState.coords) {
      const coords = locationState.coords;
      setUserLocation(coords);
      setMapCenter([coords.lat, coords.lng]);
      const newOrigin = {
        name: 'Your Location (Live GPS)',
        lat: coords.lat,
        lng: coords.lng,
      };
      setOrigin(newOrigin);
      triggerRoutePlan(newOrigin, destination, vehicle, objective);
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setIsLocating(false);
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        setMapCenter([coords.lat, coords.lng]);

        const newOrigin = {
          name: 'Your Location (Live GPS)',
          lat: coords.lat,
          lng: coords.lng,
        };
        setOrigin(newOrigin);
        triggerRoutePlan(newOrigin, destination, vehicle, objective);
      },
      (err) => {
        setIsLocating(false);
        console.warn('GPS location error:', err.message);
        // Fallback to Shillong HQ
        const fallback = { name: 'Shillong Command HQ', nodeId: 'N1', lat: 25.5788, lng: 91.8933 };
        setOrigin(fallback);
        triggerRoutePlan(fallback, destination, vehicle, objective);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Selected route from result
  const currentActiveRoute: RouteAlternative | null =
    routeResult?.routes?.find((r) => r.rank === selectedRouteRank) || routeResult?.routes?.[0] || null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0B1120] font-sans select-none">
      {/* 1. Full-Screen Interactive Network Map */}
      <div className="absolute inset-0 z-0">
        <NetworkMap
          roadsGeoJSON={roadsGeoJSON}
          nodes={nodes}
          hazards={hazards}
          activeRoute={currentActiveRoute}
          alternativeRoutes={routeResult?.routes || []}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={(id) => setSelectedSegmentId(id)}
          onSelectHazard={(h) => setSelectedHazard(h)}
          onSelectRoute={(rank) => setSelectedRouteRank(rank)}
          onSetOrigin={(loc) => {
            const locObj = { name: loc.name || 'Selected Point', lat: loc.lat, lng: loc.lng };
            setOrigin(locObj);
            triggerRoutePlan(locObj, destination, vehicle, objective);
          }}
          onSetDestination={(loc) => {
            const locObj = { name: loc.name || 'Selected Point', lat: loc.lat, lng: loc.lng };
            setDestination(locObj);
            triggerRoutePlan(origin, locObj, vehicle, objective);
          }}
          onReportHere={(coords) => {
            setReportCoords(coords);
            setIsReportModalOpen(true);
          }}
          originCoords={origin.lat && origin.lng ? { lat: origin.lat, lng: origin.lng, name: origin.name } : null}
          destCoords={destination.lat && destination.lng ? { lat: destination.lat, lng: destination.lng, name: destination.name } : null}
          userLocation={userLocation ? { lat: userLocation.lat, lng: userLocation.lng, heading: locationState.heading, accuracy: locationState.accuracyM } : null}
          isFollowingUser={locationState.isFollowing && !drivingState.isNavigating}
          onUserPan={() => setFollowing(false)}
          isNavigating={drivingState.isNavigating}
          isFollowingCamera={drivingState.isFollowingCamera}
          vehicleCoords={drivingState.currentCoords}
          vehicleBearing={drivingState.bearing}
          vehicleSpeedKmh={drivingState.speedKmh}
          showHazards={showHazards}
          showWeather={showWeather}
          weatherRainMm={conditions?.weather?.currentRainMm || 0}
          weatherDesc={conditions?.weather?.conditionDescription || 'Clear'}
          center={mapCenter}
          zoom={mapZoom}
        />
      </div>

      {/* 2. Floating Top Search & Vehicle Selector Bar */}
      {!drivingState.isNavigating && (
        <SearchHeader
          onSelectOrigin={(loc) => {
            setOrigin(loc);
            triggerRoutePlan(loc, destination, vehicle, objective);
          }}
          onSelectDestination={(loc) => {
            setDestination(loc);
            triggerRoutePlan(origin, loc, vehicle, objective);
          }}
          onSwapLocations={handleSwapLocations}
          selectedVehicle={vehicle}
          onSelectVehicle={handleSelectVehicle}
          objective={objective}
          onToggleObjective={(obj) => {
            setObjective(obj);
            triggerRoutePlan(origin, destination, vehicle, obj);
          }}
          currentOriginName={origin.name}
          currentDestinationName={destination.name}
          onUseMyLocation={handleUseMyLocation}
          isLocating={isLocating}
          onSearchRoute={() => triggerRoutePlan(origin, destination, vehicle, objective)}
        />
      )}

      {/* 2b. User Error Banner */}
      {!drivingState.isNavigating && routeError && (
        <div className="absolute top-[280px] md:top-[160px] left-4 right-4 md:left-4 md:w-[420px] z-[1001] bg-rose-950/90 border border-rose-500/60 rounded-xl p-3 shadow-xl backdrop-blur-md flex items-start gap-2.5 text-rose-100 text-xs">
          <span className="text-base text-rose-400">⚠️</span>
          <div className="flex-1">
            <p className="font-semibold text-rose-200">Unable to Route</p>
            <p className="mt-0.5 leading-relaxed">{routeError}</p>
          </div>
          <button onClick={() => setRouteError(null)} className="text-rose-400 hover:text-white font-bold p-1">✕</button>
        </div>
      )}

      {/* 3. Floating Layer Controls & 2-Tap Report FAB */}
      {!drivingState.isNavigating && (
        <LayerControls
          showHazards={showHazards}
          onToggleHazards={() => setShowHazards(!showHazards)}
          showWeather={showWeather}
          onToggleWeather={() => setShowWeather(!showWeather)}
          conditions={conditions}
          isFollowingLocation={locationState.isFollowing && !drivingState.isNavigating}
          onCenterLocation={() => {
            setFollowing(true);
            if (locationState.coords) {
              setMapCenter([locationState.coords.lat, locationState.coords.lng]);
            } else {
              handleUseMyLocation();
            }
          }}
          onOpenReport={() => {
            setReportCoords(userLocation || { lat: 25.40, lng: 91.85 });
            setIsReportModalOpen(true);
          }}
        />
      )}

      {/* 4. Bottom Sheet: Route Options, ETA, Voice Guidance ("Tell Route") & Step-by-Step Directions */}
      {!drivingState.isNavigating && (
        <RouteBottomSheet
          routeResult={routeResult}
          selectedRouteRank={selectedRouteRank}
          onSelectRoute={(rank) => setSelectedRouteRank(rank)}
          onHighlightSegment={(edgeId) => setSelectedSegmentId(edgeId)}
          onStartNavigation={handleStartNavigation}
          isLoading={isLoadingRoutes}
          onClose={() => setRouteResult(null)}
        />
      )}

      {/* 5. Live Turn-by-Turn GPS Driving Navigation HUD */}
      <DrivingNavigationOverlay
        drivingState={drivingState}
        vehicleName={routeResult?.vehicle?.name || 'Car'}
        onStopNavigation={stopNavigation}
        onToggleMute={toggleMute}
        onToggleSimulation={toggleSimulation}
        onSetSimulationSpeed={setSimulationMultiplier}
        onRecenterMap={handleRecenterMap}
      />

      {/* 6. 2-Tap Report Hazard Modal */}
      <ReportHazardModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        defaultLocation={reportCoords}
        onReportCreated={() => {
          loadData();
          triggerRoutePlan();
        }}
      />

      {/* 7. Hazard Confirmation Card ("Still There? [Yes] [No] [Cleared]") */}
      <HazardConfirmationCard
        hazard={selectedHazard}
        onClose={() => setSelectedHazard(null)}
        userLocation={userLocation}
        onVoteCast={() => {
          loadData();
          triggerRoutePlan();
        }}
      />
    </div>
  );
};

export default App;
