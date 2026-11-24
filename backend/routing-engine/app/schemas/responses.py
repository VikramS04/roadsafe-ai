from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class ConstraintApplied(BaseModel):
    edge_id: str
    from_node: str
    to_node: str
    reason: str


class CostBreakdown(BaseModel):
    delay_cost: float
    risk_cost: float
    resource_cost: float
    total: float
    safety_score: float
    disruption_probability: float


class Bottleneck(BaseModel):
    edge_id: str
    from_node: str
    to_node: str
    safety_score: float
    reason: str


class RouteEdgeDetail(BaseModel):
    edge_id: str
    from_node: str
    to_node: str
    name: Optional[str] = None
    distance_km: float
    base_travel_time_min: float
    safety_score: float
    risk_band: str  # Green, Yellow, Red
    cost_breakdown: CostBreakdown
    coordinates: Optional[List[List[float]]] = None


class TurnInstruction(BaseModel):
    action: str
    road: str
    distance_km: float
    duration_min: float
    instruction: str
    location: List[float]


class RoutePath(BaseModel):
    rank: int
    total_cost: float
    estimated_travel_minutes: float
    composite_safety_score: float
    nodes: List[str]
    edges: List[RouteEdgeDetail]
    bottleneck: Optional[Bottleneck] = None
    coordinates: List[List[float]] = Field(default_factory=list)
    turn_instructions: Optional[List[TurnInstruction]] = None


class DataQuality(BaseModel):
    stale_hazards: bool = False
    freshness_timestamp: str
    confidence_discount_applied: float = 0.0
    source: str = "OpenStreetMap (© OpenStreetMap contributors) - East Khasi Hills Road Network"


class RouteComputeResponse(BaseModel):
    request_id: str
    status: str  # FEASIBLE, NO_FEASIBLE_ROUTE, DEGRADED
    constraints_applied: List[ConstraintApplied] = Field(default_factory=list)
    paths: List[RoutePath] = Field(default_factory=list)
    confidence_score: float = 0.0
    rationale: str
    data_quality: DataQuality


class FactorContribution(BaseModel):
    feature_name: str
    value: float
    weight: float
    impact: str  # low, medium, high


class PassabilityAnalyzeResponse(BaseModel):
    segment_id: str
    vehicle_profile_id: str
    safety_score: float
    risk_band: str  # Green (>=0.80), Yellow (0.50-0.79), Red (<0.50)
    z_score: float
    factors: List[FactorContribution]
    recommendation: str
