from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class NodeLocation(BaseModel):
    node_id: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class VehicleRequestProfile(BaseModel):
    profile_id: str = "car"  # bike, car, tractor, truck, ambulance
    weight_kg: Optional[float] = None
    width_m: Optional[float] = None
    height_m: Optional[float] = None
    min_safety_score: Optional[float] = 0.50
    is_hazmat: bool = False


class IncidentContext(BaseModel):
    excluded_segment_ids: List[str] = Field(default_factory=list)
    temporary_closures: List[str] = Field(default_factory=list)


class HazardContext(BaseModel):
    edge_id: str
    hazard_type: str = "landslide"  # landslide, flooded_road, fallen_tree, damaged_road, bridge_damaged, road_blocked, fog, other
    severity: str = "medium"        # low, medium, high, critical
    status: str = "unverified"      # unverified, confirmed, cleared, expired
    confirm_count: int = 0
    clear_count: int = 0
    decay_factor: float = 1.0       # 1.0 (fresh) down to 0.0 (near 6h expiry)


class RouteComputeRequest(BaseModel):
    request_id: str
    source: NodeLocation
    destination: NodeLocation
    vehicle: VehicleRequestProfile = Field(default_factory=VehicleRequestProfile)
    urgency_profile: str = "standard"  # emergency, standard, relief_logistics, economy
    objective: str = "safest"          # "safest" (default) or "fastest"
    k: int = 3
    incident_context: Optional[IncidentContext] = None
    hazard_context: List[HazardContext] = Field(default_factory=list)


class PassabilityFeatureInput(BaseModel):
    rainfall_current_mm: float = 0.0
    rainfall_24h_mm: float = 0.0
    rainfall_72h_mm: float = 0.0
    slope_deg: float = 5.0
    landslide_susceptibility: float = 0.1  # 0 to 1
    surface_damage: float = 0.0  # 0 (good) to 1 (severe)
    waterlogging_depth_cm: float = 0.0
    road_narrowness_m: float = 6.0


class PassabilityAnalyzeRequest(BaseModel):
    segment_id: str
    vehicle_profile_id: str = "car"
    features: Optional[PassabilityFeatureInput] = None

