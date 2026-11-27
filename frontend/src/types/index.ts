export interface RoadNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elevationM: number;
  isHub: boolean;
  district: string;
}

export interface RoadSegmentProperties {
  id: string;
  name: string;
  from_node: string;
  to_node: string;
  from_node_name: string;
  to_node_name: string;
  distance_km: number;
  travel_time_min: number;
  road_class: string;
  width_m: number;
  max_weight_kg: number;
  max_clearance_m: number;
  is_bridge: boolean;
  status: 'open' | 'caution' | 'blocked' | 'closed';
  risk_band: 'Green' | 'Yellow' | 'Red' | 'Grey';
  rainfall_norm: number;
  slope_norm: number;
  landslide_risk: number;
  surface_damage: number;
  waterlogging_norm: number;
  narrowness_norm: number;
  active_hazards?: Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    confirmCount: number;
  }>;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: RoadSegmentProperties;
}

export interface RoadGeoJSON {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface VehicleProfile {
  id: string;
  name: string;
  type: string;
  maxWeightKg: number;
  maxWidthM: number;
  minClearanceM: number;
  minSafetyScore: number;
  description?: string;
}

export interface HazardReport {
  id: string;
  type: 'landslide' | 'flooded_road' | 'fallen_tree' | 'damaged_road' | 'bridge_damaged' | 'road_blocked' | 'fog' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  edgeId?: string | null;
  lat: number;
  lng: number;
  status: 'unverified' | 'confirmed' | 'cleared' | 'expired';
  confirmCount: number;
  disputeCount?: number;
  clearCount: number;
  userVote?: 'yes' | 'no' | 'cleared' | null;
  note?: string | null;
  photoUrl?: string | null;
  deviceId: string;
  reportedAt: string;
  expiresAt: string;
  decayFactor?: number;
  source?: string;
  isImported?: boolean;
  stateRegion?: string;
  areaDesc?: string;
  geometryJson?: string;
  lastCheckedAt?: string;
}

export interface HazardSourceStatusInfo {
  id: string;
  providerName: string;
  stateRegion: string;
  status: 'hazards_reported' | 'no_records' | 'unavailable' | 'stale';
  recordCount: number;
  lastCheckedAt: string;
  lastSuccessAt?: string | null;
  errorMessage?: string | null;
  isStale: boolean;
}

export interface WeatherConditions {
  latitude: number;
  longitude: number;
  currentPrecipitationMm: number | null;
  currentRainMm: number | null;
  weatherCode: number | null;
  conditionDescription: string;
  source?: 'open-meteo' | 'unavailable';
  isStale: boolean;
  unavailable?: boolean;
  fetchedAt: string | null;
  error?: string;
}

export interface ConditionsResponse {
  weather: WeatherConditions;
  alerts: OfficialAlert[];
  alertsMeta?: {
    configured: boolean;
    isStale: boolean;
    fetchedAt: string | null;
  };
  timestamp: string;
}

export interface OfficialAlert {
  id: string;
  source: 'IMD' | 'SDMA' | 'LOCAL_AUTHORITY' | 'MANUAL';
  headline: string;
  severity: 'low' | 'moderate' | 'severe' | 'extreme';
  urgency: 'immediate' | 'expected' | 'past';
  affectedRegion: string;
  description: string;
  effectiveFrom: string;
  expiresAt: string;
}

export interface ConditionsResponse {
  weather: WeatherConditions;
  alerts: OfficialAlert[];
  timestamp: string;
}

export interface Bottleneck {
  edge_id: string;
  from_node: string;
  to_node: string;
  safety_score: number;
  reason: string;
}

export interface RouteEdgeDetail {
  edge_id: string;
  name?: string;
  distance_km: number;
  safety_score: number;
  risk_band: 'Green' | 'Yellow' | 'Red';
  coordinates?: number[][];
}

export interface TurnInstruction {
  action: string;
  road: string;
  distance_km: number;
  duration_min: number;
  instruction: string;
  location: [number, number];
}

export interface RouteAlternative {
  rank: number;
  is_recommended: boolean;
  total_cost: number;
  estimated_travel_minutes: number;
  distance_km: number;
  composite_safety_score: number;
  safety_band: 'Green' | 'Yellow' | 'Red';
  nodes: string[];
  edges: RouteEdgeDetail[];
  bottleneck?: Bottleneck;
  coordinates: number[][];
  turn_instructions?: TurnInstruction[];
  rationale: string;
}

export interface RoutePlanningResponse {
  request_id: string;
  status: 'FEASIBLE' | 'NO_FEASIBLE_ROUTE' | 'DEGRADED';
  objective: 'safest' | 'fastest';
  routing_provider?: 'east_khasi_hills_osm' | 'osrm_global';
  routing_mode?: 'hazard_aware_local' | 'ordinary_with_hazards' | 'ordinary_unverified';
  hazard_coverage?: {
    status: 'verified' | 'partial' | 'unavailable' | 'no_records';
    warning: string | null;
  };
  vehicle_limitations?: string | null;
  vehicle: {
    id: string;
    name: string;
    type: string;
  };
  routes: RouteAlternative[];
  constraints_applied: Array<{
    edge_id: string;
    from_node: string;
    to_node: string;
    reason: string;
  }>;
  confidence_score: number;
  rationale: string;
}

export interface GeocodeResult {
  place_id: string;
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  node_id?: string;
  in_coverage?: boolean;
  coverage_zone?: 'local_hazard_aware' | 'regional_hazards' | 'global_ordinary';
  source?: string;
}
