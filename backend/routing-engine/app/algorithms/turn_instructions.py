import math
from typing import List, Dict, Any, Tuple


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates compass initial bearing in degrees from point 1 to point 2 (0-360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)

    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)

    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360.0) % 360.0


def classify_turn(angle_diff: float) -> Tuple[str, str]:
    """
    Classifies angle difference into turn type and human-readable verb.
    angle_diff is in [-180, 180], positive is right, negative is left.
    """
    if abs(angle_diff) < 20.0:
        return "continue", "Continue straight"
    elif 20.0 <= angle_diff < 50.0:
        return "slight_right", "Slight right"
    elif 50.0 <= angle_diff < 125.0:
        return "turn_right", "Turn right"
    elif 125.0 <= angle_diff < 170.0:
        return "sharp_right", "Sharp right"
    elif -50.0 < angle_diff <= -20.0:
        return "slight_left", "Slight left"
    elif -125.0 < angle_diff <= -50.0:
        return "turn_left", "Turn left"
    elif -170.0 < angle_diff <= -125.0:
        return "sharp_left", "Sharp left"
    else:
        return "u_turn", "Make a U-turn"


def generate_turn_instructions(edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Generates realistic, merged turn-by-turn driving instructions from edge geometries.
    Merges consecutive segments with the same road name unless a sharp turn occurs.
    """
    if not edges:
        return []

    instructions: List[Dict[str, Any]] = []

    # First instruction: Depart
    first_edge = edges[0]
    first_name = first_edge.get("name") or "the road"
    first_coords = first_edge.get("coordinates", [])
    first_loc = first_coords[0] if first_coords else [0.0, 0.0]

    curr_action = "depart"
    curr_verb = "Head"
    curr_road = first_name
    curr_dist_km = first_edge.get("distance_km", 0.0)
    curr_time_min = first_edge.get("base_travel_time_min", 0.0)
    curr_loc = first_loc

    # Track entry/exit bearing of edges
    def get_edge_bearings(e: Dict[str, Any]) -> Tuple[float, float]:
        coords = e.get("coordinates", [])
        if len(coords) >= 2:
            b_in = calculate_bearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0])
            b_out = calculate_bearing(coords[-2][1], coords[-2][0], coords[-1][1], coords[-1][0])
            return b_in, b_out
        return 0.0, 0.0

    _, last_b_out = get_edge_bearings(first_edge)

    for i in range(1, len(edges)):
        next_edge = edges[i]
        next_name = next_edge.get("name") or "the road"
        next_b_in, next_b_out = get_edge_bearings(next_edge)

        # Calculate bearing delta
        diff = (next_b_in - last_b_out + 180.0) % 360.0 - 180.0
        turn_type, verb = classify_turn(diff)

        # Check if same road and continuing straight
        is_same_road = (next_name == curr_road) or (not next_name and curr_road)
        is_straight = abs(diff) < 30.0

        if is_same_road and is_straight:
            # Merge into current instruction
            curr_dist_km += next_edge.get("distance_km", 0.0)
            curr_time_min += next_edge.get("base_travel_time_min", 0.0)
        else:
            # Emit completed instruction
            dist_text = f"{int(curr_dist_km * 1000)} m" if curr_dist_km < 1.0 else f"{curr_dist_km:.1f} km"
            text = f"{curr_verb} on {curr_road} for {dist_text}"
            instructions.append({
                "action": curr_action,
                "road": curr_road,
                "distance_km": round(curr_dist_km, 3),
                "duration_min": round(curr_time_min, 1),
                "instruction": text,
                "location": curr_loc,
            })

            # Start new instruction
            coords = next_edge.get("coordinates", [])
            curr_loc = coords[0] if coords else [0.0, 0.0]
            curr_action = turn_type
            curr_verb = verb
            curr_road = next_name
            curr_dist_km = next_edge.get("distance_km", 0.0)
            curr_time_min = next_edge.get("base_travel_time_min", 0.0)

        last_b_out = next_b_out

    # Emit last driving instruction
    dist_text = f"{int(curr_dist_km * 1000)} m" if curr_dist_km < 1.0 else f"{curr_dist_km:.1f} km"
    instructions.append({
        "action": curr_action,
        "road": curr_road,
        "distance_km": round(curr_dist_km, 3),
        "duration_min": round(curr_time_min, 1),
        "instruction": f"{curr_verb} on {curr_road} for {dist_text}",
        "location": curr_loc,
    })

    # Final arrive instruction
    last_coords = edges[-1].get("coordinates", [])
    arrive_loc = last_coords[-1] if last_coords else curr_loc
    instructions.append({
        "action": "arrive",
        "road": curr_road,
        "distance_km": 0.0,
        "duration_min": 0.0,
        "instruction": "You have arrived at your destination",
        "location": arrive_loc,
    })

    return instructions
