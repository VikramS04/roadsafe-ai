import {
  RoadGeoJSON,
  RoadNode,
  VehicleProfile,
  HazardReport,
  ConditionsResponse,
  RoutePlanningResponse,
  GeocodeResult,
} from '../types';

const BASE_URL = '/api/v1';

// Device identity management in localStorage
function getDeviceId(): string {
  let id = localStorage.getItem('roadsafe_device_id');
  if (!id) {
    id = 'dev-' + crypto.randomUUID();
    localStorage.setItem('roadsafe_device_id', id);
  }
  return id;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const deviceId = getDeviceId();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('x-device-id', deviceId);

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const updatedDeviceId = res.headers.get('x-device-id');
  if (updatedDeviceId && updatedDeviceId !== deviceId) {
    localStorage.setItem('roadsafe_device_id', updatedDeviceId);
  }

  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `HTTP error ${res.status}`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

export const api = {
  // Geocoding & Places
  async geocode(query: string, signal?: AbortSignal): Promise<{ results: GeocodeResult[] }> {
    return request(`/geocode?q=${encodeURIComponent(query)}`, { signal });
  },

  async getNearestNode(lat: number, lng: number): Promise<{ node: RoadNode; distanceDegrees: number }> {
    return request(`/geocode/nearest-node?lat=${lat}&lng=${lng}`);
  },

  // Route Planning
  async planRoute(params: {
    origin: { nodeId?: string; lat?: number; lng?: number } | string;
    destination: { nodeId?: string; lat?: number; lng?: number } | string;
    vehicle: string;
    objective?: 'safest' | 'fastest';
    k?: number;
  }): Promise<RoutePlanningResponse> {
    return request('/routes', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Hazards
  async getHazards(bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }): Promise<{ hazards: HazardReport[]; count: number }> {
    const qs = bbox ? `?minLat=${bbox.minLat}&minLng=${bbox.minLng}&maxLat=${bbox.maxLat}&maxLng=${bbox.maxLng}` : '';
    return request(`/hazards${qs}`);
  },

  async getHazard(id: string): Promise<{ hazard: HazardReport }> {
    return request(`/hazards/${id}`);
  },

  async reportHazard(data: {
    type: string;
    severity?: string;
    latitude: number;
    longitude: number;
    note?: string;
    photo_url?: string;
  }): Promise<{ message: string; report: HazardReport }> {
    return request('/hazards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async voteHazard(
    id: string,
    data: { vote: 'yes' | 'no' | 'cleared'; voter_latitude?: number; voter_longitude?: number }
  ): Promise<{
    message: string;
    statusChanged: boolean;
    newStatus: string;
    confirmCount: number;
    disputeCount?: number;
    clearCount: number;
    userVote?: 'yes' | 'no' | 'cleared';
    report: HazardReport;
  }> {
    return request(`/hazards/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Conditions (Weather & Alerts)
  async getConditions(lat?: number, lng?: number): Promise<ConditionsResponse> {
    const qs = lat && lng ? `?lat=${lat}&lng=${lng}` : '';
    return request(`/conditions${qs}`);
  },

  // GIS & Road Network
  async getRoadsGeoJSON(): Promise<RoadGeoJSON> {
    return request('/roads/geojson');
  },

  async getNodes(): Promise<{ status: string; data: RoadNode[] }> {
    return request('/nodes');
  },

  async getVehicles(): Promise<{ status: string; data: VehicleProfile[] }> {
    return request('/vehicles');
  },

  async getSegmentPassability(segmentId: string, vehicle: string = 'car'): Promise<any> {
    return request(`/segments/${segmentId}/passability?vehicle=${vehicle}`);
  },

  // Health
  async getHealth(): Promise<any> {
    return request('/health');
  },
};
