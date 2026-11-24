from fastapi import APIRouter
from ..schemas.requests import PassabilityAnalyzeRequest
from ..schemas.responses import PassabilityAnalyzeResponse, FactorContribution
from ..passability.model import calculate_passability

router = APIRouter()


@router.post("/analyze", response_model=PassabilityAnalyzeResponse)
def analyze_passability(req: PassabilityAnalyzeRequest):
    """
    Computes vehicle-specific passability score S(e,v,t) = sigmoid(z).
    Returns numeric score, risk band, z-score, and factor breakdown.
    """
    f = req.features
    rainfall = (f.rainfall_current_mm + f.rainfall_24h_mm * 0.1) / 100.0 if f else 0.0
    slope = (f.slope_deg / 30.0) if f else 0.0
    landslide = f.landslide_susceptibility if f else 0.0
    surface = f.surface_damage if f else 0.0
    waterlog = (f.waterlogging_depth_cm / 50.0) if f else 0.0
    narrow = max(0.0, (8.0 - f.road_narrowness_m) / 5.0) if f else 0.0

    safety_score, z_score, risk_band, factors = calculate_passability(
        vehicle_profile=req.vehicle_profile_id,
        rainfall_norm=rainfall,
        slope_norm=slope,
        landslide_risk=landslide,
        surface_damage=surface,
        waterlogging_norm=waterlog,
        narrowness_norm=narrow,
    )

    factor_objs = [FactorContribution(**item) for item in factors]

    if risk_band == "Green":
        rec = "Optimal condition: Safe for normal operational dispatch."
    elif risk_band == "Yellow":
        rec = "Caution advised: Reduced speed and driver alert recommended."
    else:
        rec = "High Hazard: Route avoidance or supervisor override required."

    return PassabilityAnalyzeResponse(
        segment_id=req.segment_id,
        vehicle_profile_id=req.vehicle_profile_id,
        safety_score=safety_score,
        risk_band=risk_band,
        z_score=z_score,
        factors=factor_objs,
        recommendation=rec,
    )

