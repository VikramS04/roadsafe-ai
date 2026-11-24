const PYTHON_URL = process.env.PYTHON_ROUTING_URL || 'http://localhost:8000';

export interface PythonRouteRequest {
  request_id: string;
  source: { node_id?: string; lat?: number; lng?: number };
  destination: { node_id?: string; lat?: number; lng?: number };
  vehicle: {
    profile_id: string;
    weight_kg?: number;
    width_m?: number;
    height_m?: number;
    min_safety_score?: number;
  };
  urgency_profile?: string;
  objective?: 'safest' | 'fastest';
  k?: number;
  incident_context?: {
    excluded_segment_ids: string[];
    temporary_closures?: string[];
  };
  hazard_context?: Array<{
    edge_id: string;
    hazard_type: string;
    severity?: string;
    status: string;
    confirm_count?: number;
    clear_count?: number;
    decay_factor?: number;
  }>;
}

export interface PythonRouteResponse {
  request_id: string;
  status: 'FEASIBLE' | 'NO_FEASIBLE_ROUTE' | 'DEGRADED';
  constraints_applied: Array<{
    edge_id: string;
    from_node: string;
    to_node: string;
    reason: string;
  }>;
  paths: Array<{
    rank: number;
    total_cost: number;
    estimated_travel_minutes: number;
    composite_safety_score: number;
    nodes: string[];
    edges: Array<{
      edge_id: string;
      from_node: string;
      to_node: string;
      name?: string;
      distance_km: number;
      base_travel_time_min: number;
      safety_score: number;
      risk_band: string;
      cost_breakdown: {
        delay_cost: number;
        risk_cost: number;
        resource_cost: number;
        total: number;
        safety_score: number;
        disruption_probability: number;
      };
      coordinates?: number[][];
    }>;
    bottleneck?: {
      edge_id: string;
      from_node: string;
      to_node: string;
      safety_score: number;
      reason: string;
    };
    coordinates: number[][];
    turn_instructions?: Array<{
      action: string;
      road: string;
      distance_km: number;
      duration_min: number;
      instruction: string;
      location: number[];
    }>;
  }>;
  confidence_score: number;
  rationale: string;
  data_quality: {
    stale_hazards: boolean;
    freshness_timestamp: string;
    confidence_discount_applied: number;
    source: string;
  };
}

export async function callPythonComputeRoute(payload: PythonRouteRequest): Promise<PythonRouteResponse> {
  const url = `${PYTHON_URL}/internal/v1/routes/compute`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout for complex regional graph

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Python routing microservice error (${res.status}): ${errBody}`);
    }

    return (await res.json()) as PythonRouteResponse;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Routing calculation timed out after 25 seconds.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callPythonPassability(payload: any): Promise<any> {
  const url = `${PYTHON_URL}/internal/v1/passability/analyze`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Passability analysis failed (${res.status})`);
  }

  return await res.json();
}

export async function checkPythonHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_URL}/internal/v1/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

