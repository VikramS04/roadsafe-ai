import math
from typing import Dict, Any, Tuple, List


# Vehicle profile coefficients
# b_v: base usability intercept
# w_rainfall: sensitivity to rainfall (normalized 0-1)
# w_slope: sensitivity to slope (normalized 0-1)
# w_landslide: sensitivity to landslide susceptibility (0-1)
# w_surface: sensitivity to surface damage (0-1)
# w_waterlog: sensitivity to waterlogging (0-1)
# w_narrow: sensitivity to road narrowness (< 4m)
VEHICLE_CONFIGS: Dict[str, Dict[str, float]] = {
    "bike": {
        "b_v": 3.8,
        "w_rainfall": 1.4,
        "w_slope": 0.8,
        "w_landslide": 2.2,
        "w_surface": 1.6,
        "w_waterlog": 2.0,
        "w_narrow": 0.1,  # bikes can easily navigate narrow roads
        "min_safety": 0.40,
        "default_weight_kg": 200.0,
        "default_width_m": 0.9,
    },
    "car": {
        "b_v": 4.2,
        "w_rainfall": 1.0,
        "w_slope": 1.0,
        "w_landslide": 1.8,
        "w_surface": 1.2,
        "w_waterlog": 1.4,
        "w_narrow": 0.8,
        "min_safety": 0.50,
        "default_weight_kg": 1800.0,
        "default_width_m": 1.8,
    },
    "suv": {
        "b_v": 4.0,
        "w_rainfall": 0.8,
        "w_slope": 0.8,
        "w_landslide": 1.4,
        "w_surface": 0.6,
        "w_waterlog": 0.8,
        "w_narrow": 1.0,
        "min_safety": 0.45,
        "default_weight_kg": 2800.0,
        "default_width_m": 2.0,
    },
    "tractor": {
        "b_v": 3.6,
        "w_rainfall": 0.6,
        "w_slope": 0.9,
        "w_landslide": 1.3,
        "w_surface": 0.4,  # high off-road tolerance
        "w_waterlog": 0.7,
        "w_narrow": 0.9,
        "min_safety": 0.45,
        "default_weight_kg": 4000.0,
        "default_width_m": 2.2,
    },
    "truck": {
        "b_v": 4.0,
        "w_rainfall": 1.2,
        "w_slope": 1.6,  # steep slopes are dangerous for heavy trucks
        "w_landslide": 2.5,
        "w_surface": 1.4,
        "w_waterlog": 1.2,
        "w_narrow": 2.2,  # cannot fit in narrow mountain passages
        "min_safety": 0.60,
        "default_weight_kg": 15000.0,
        "default_width_m": 2.6,
    },
    "ambulance": {
        "b_v": 4.5,
        "w_rainfall": 1.1,
        "w_slope": 1.1,
        "w_landslide": 2.0,
        "w_surface": 1.5,
        "w_waterlog": 1.6,
        "w_narrow": 1.0,
        "min_safety": 0.55,
        "default_weight_kg": 3500.0,
        "default_width_m": 2.1,
    },
}

# Urgency profile weights: alpha (delay), beta (risk), gamma (resource)
URGENCY_CONFIGS: Dict[str, Dict[str, float]] = {
    "emergency": {
        "alpha": 1.5,   # Minimize delay aggressively
        "beta": 2.5,    # High safety penalty: cannot get stuck
        "gamma": 0.2,   # Resource cost is secondary
    },
    "standard": {
        "alpha": 1.0,
        "beta": 1.5,
        "gamma": 0.5,
    },
    "relief_logistics": {
        "alpha": 0.8,
        "beta": 2.0,    # High risk aversion to avoid losing supplies
        "gamma": 1.2,   # Fuel and wear matter for repeat supply convoys
    },
    "economy": {
        "alpha": 0.6,
        "beta": 1.0,
        "gamma": 1.8,
    },
}


def sigmoid(z: float) -> float:
    """Standard sigmoid function bounded in [0, 1]."""
    if z < -20.0:
        return 0.0
    if z > 20.0:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def calculate_passability(
    vehicle_profile: str,
    rainfall_norm: float = 0.0,      # 0 (dry) to 1 (extreme rain > 150mm)
    slope_norm: float = 0.0,         # 0 (flat) to 1 (steep > 20 deg)
    landslide_risk: float = 0.0,     # 0 (stable) to 1 (active landslide)
    surface_damage: float = 0.0,     # 0 (smooth) to 1 (destroyed)
    waterlogging_norm: float = 0.0,  # 0 (none) to 1 (> 50cm water)
    narrowness_norm: float = 0.0,    # 0 (wide >= 8m) to 1 (narrow <= 3m)
) -> Tuple[float, float, str, List[Dict[str, Any]]]:
    """
    Computes S(e,v,t) = sigmoid(b_v - sum(w * f))
    Returns: (safety_score, z_score, risk_band, factor_contributions)
    """
    cfg = VEHICLE_CONFIGS.get(vehicle_profile.lower(), VEHICLE_CONFIGS["car"])
    b_v = cfg["b_v"]

    term_rain = cfg["w_rainfall"] * max(0.0, min(1.0, rainfall_norm))
    term_slope = cfg["w_slope"] * max(0.0, min(1.0, slope_norm))
    term_landslide = cfg["w_landslide"] * max(0.0, min(1.0, landslide_risk))
    term_surface = cfg["w_surface"] * max(0.0, min(1.0, surface_damage))
    term_water = cfg["w_waterlog"] * max(0.0, min(1.0, waterlogging_norm))
    term_narrow = cfg["w_narrow"] * max(0.0, min(1.0, narrowness_norm))

    penalties = term_rain + term_slope + term_landslide + term_surface + term_water + term_narrow
    z = b_v - penalties
    safety_score = round(sigmoid(z), 4)

    if safety_score >= 0.80:
        risk_band = "Green"
    elif safety_score >= 0.50:
        risk_band = "Yellow"
    else:
        risk_band = "Red"

    factors = [
        {"feature_name": "Rainfall", "value": round(rainfall_norm, 3), "weight": cfg["w_rainfall"], "impact": "high" if term_rain > 0.8 else "medium" if term_rain > 0.3 else "low"},
        {"feature_name": "Slope Gradient", "value": round(slope_norm, 3), "weight": cfg["w_slope"], "impact": "high" if term_slope > 0.8 else "medium" if term_slope > 0.3 else "low"},
        {"feature_name": "Landslide Hazard", "value": round(landslide_risk, 3), "weight": cfg["w_landslide"], "impact": "high" if term_landslide > 0.8 else "medium" if term_landslide > 0.3 else "low"},
        {"feature_name": "Surface Damage", "value": round(surface_damage, 3), "weight": cfg["w_surface"], "impact": "high" if term_surface > 0.8 else "medium" if term_surface > 0.3 else "low"},
        {"feature_name": "Waterlogging", "value": round(waterlogging_norm, 3), "weight": cfg["w_waterlog"], "impact": "high" if term_water > 0.8 else "medium" if term_water > 0.3 else "low"},
        {"feature_name": "Road Narrowness", "value": round(narrowness_norm, 3), "weight": cfg["w_narrow"], "impact": "high" if term_narrow > 0.8 else "medium" if term_narrow > 0.3 else "low"},
    ]

    return safety_score, round(z, 3), risk_band, factors


def calculate_edge_cost(
    base_travel_time_min: float,
    safety_score: float,
    distance_km: float,
    urgency_profile: str = "standard",
    objective: str = "safest",
) -> Tuple[float, Dict[str, float]]:
    """
    Cost formula per specification Section 4:
    cost(edge) = alpha * delay(edge) + beta * risk(edge) + gamma * resource(edge)
    risk(edge) = -ln(safety_score)
    Supports objective: "safest" (prioritizes safety) vs "fastest" (prioritizes travel time).
    """
    cfg = URGENCY_CONFIGS.get(urgency_profile.lower(), URGENCY_CONFIGS["standard"])
    alpha = cfg["alpha"]
    beta = cfg["beta"]
    gamma = cfg["gamma"]

    if objective.lower() == "fastest":
        alpha = alpha * 2.5
        beta = beta * 0.3
        gamma = gamma * 0.5
    else:  # "safest" is default
        alpha = alpha * 0.15
        beta = beta * 6.0
        gamma = gamma * 0.2

    # delay cost in minutes
    delay_cost = base_travel_time_min * alpha

    # risk penalty using -ln(S) and safety band tiering
    safe_s = max(0.001, min(1.0, safety_score))
    risk_metric = -math.log(safe_s)
    
    # Base risk cost proportional to -ln(S)
    risk_cost = risk_metric * 25.0 * beta

    # Escalating penalties for degrading safety bands
    if objective.lower() != "fastest":
        if safe_s < 0.80:
            # Yellow band penalty (below 0.80)
            risk_cost += (0.80 - safe_s) * 80.0 * beta
        if safe_s < 0.50:
            # Severe Red band penalty (below 0.50)
            risk_cost += (0.50 - safe_s) * 300.0 * beta + 150.0

    # resource cost proportional to distance
    resource_cost = distance_km * 0.5 * gamma

    total_cost = round(delay_cost + risk_cost + resource_cost, 4)
    disruption_prob = round(1.0 - safe_s, 4)

    cost_breakdown = {
        "delay_cost": round(delay_cost, 4),
        "risk_cost": round(risk_cost, 4),
        "resource_cost": round(resource_cost, 4),
        "total": total_cost,
        "safety_score": round(safety_score, 4),
        "disruption_probability": disruption_prob,
    }

    return total_cost, cost_breakdown

