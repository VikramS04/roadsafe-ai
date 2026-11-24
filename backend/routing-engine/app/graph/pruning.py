from typing import Tuple, List, Dict, Any, Optional
import networkx as nx
from ..passability.model import calculate_passability, VEHICLE_CONFIGS


def prune_graph_hard_constraints(
    graph: nx.DiGraph,
    vehicle_profile: str,
    vehicle_weight_kg: Optional[float] = None,
    vehicle_width_m: Optional[float] = None,
    vehicle_height_m: Optional[float] = None,
    min_safety_score: Optional[float] = None,
    excluded_segment_ids: Optional[List[str]] = None,
    hazard_context: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[nx.DiGraph, List[Dict[str, Any]]]:
    """
    Applies two-tier hard constraints per Section 4 with community hazard inputs.
    - Confirmed blocking reports (landslide, road blocked, bridge damaged) prune
      the edge for affected vehicle types (e.g. trucks, cars) while permitting
      nimble vehicles (bikes) if width/clearance allows.
    - Unverified reports apply only a mild routing penalty and never hard-close a road.
    """
    pruned = graph.copy()
    constraints_applied: List[Dict[str, Any]] = []
    edges_to_remove: List[Tuple[str, str, str, str]] = []

    excluded_set = set(excluded_segment_ids or [])
    cfg = VEHICLE_CONFIGS.get(vehicle_profile.lower(), VEHICLE_CONFIGS["car"])

    weight = vehicle_weight_kg if vehicle_weight_kg is not None else cfg.get("default_weight_kg", 1800.0)
    width = vehicle_width_m if vehicle_width_m is not None else cfg.get("default_width_m", 1.8)
    min_safety = min_safety_score if min_safety_score is not None else cfg.get("min_safety", 0.50)

    # Index hazards by edge_id
    hazards_by_edge: Dict[str, List[Dict[str, Any]]] = {}
    if hazard_context:
        for h in hazard_context:
            eid = h.get("edge_id")
            if eid:
                hazards_by_edge.setdefault(eid, []).append(h)

    for u, v, data in pruned.edges(data=True):
        edge_id = data.get("edge_id", f"{u}->{v}")
        name = data.get("name", edge_id)

        # Apply dynamic community hazard features onto edge data
        if edge_id in hazards_by_edge:
            for hz in hazards_by_edge[edge_id]:
                hz_status = hz.get("status", "unverified")
                hz_type = hz.get("hazard_type", "other")
                decay = hz.get("decay_factor", 1.0)

                if hz_status in ["cleared", "expired"]:
                    continue

                if hz_status == "confirmed":
                    # Confirmed blocking reports prune for heavy/wide vehicles
                    if hz_type in ["landslide", "road_blocked", "fallen_tree"]:
                        # Restricts usable roadway width down to 1.2m (clears narrow 2-wheelers <= 0.9m)
                        current_w = data.get("width_m", 6.0)
                        data["width_m"] = min(current_w, 1.2)
                        data["landslide_risk"] = max(data.get("landslide_risk", 0.0), 0.85 * decay)
                        data["surface_damage"] = max(data.get("surface_damage", 0.0), 0.70 * decay)
                    elif hz_type == "bridge_damaged":
                        # Drastically lowers bridge load capacity to 400kg
                        data["max_weight_kg"] = min(data.get("max_weight_kg", 30000.0), 400.0)
                        data["surface_damage"] = max(data.get("surface_damage", 0.0), 0.80 * decay)
                    elif hz_type == "flooded_road":
                        data["waterlogging_norm"] = max(data.get("waterlogging_norm", 0.0), 0.75 * decay)
                        data["surface_damage"] = max(data.get("surface_damage", 0.0), 0.50 * decay)
                    else:
                        data["surface_damage"] = max(data.get("surface_damage", 0.0), 0.40 * decay)
                elif hz_status == "unverified":
                    # Mild routing penalty ONLY - NEVER hard prune
                    if hz_type == "landslide":
                        data["landslide_risk"] = min(1.0, data.get("landslide_risk", 0.0) + 0.15 * decay)
                    elif hz_type == "flooded_road":
                        data["waterlogging_norm"] = min(1.0, data.get("waterlogging_norm", 0.0) + 0.15 * decay)
                    else:
                        data["surface_damage"] = min(1.0, data.get("surface_damage", 0.0) + 0.15 * decay)

        # 1. Incident / Dispatch Exclusion
        if edge_id in excluded_set:
            edges_to_remove.append((
                u, v, edge_id,
                f"Edge {edge_id} ({name}) excluded by active incident or manual dispatch restriction."
            ))
            continue

        # 2. Road status closed or blocked
        if data.get("status") in ["closed", "blocked"]:
            edges_to_remove.append((
                u, v, edge_id,
                f"Edge {edge_id} ({name}) is actively closed/blocked to all traffic."
            ))
            continue

        # 3. Vehicle weight exceeds bridge or segment limit
        max_weight = data.get("max_weight_kg")
        if max_weight is not None and weight > max_weight:
            bridge_flag = " (Bridge Load Limit)" if data.get("is_bridge") else ""
            edges_to_remove.append((
                u, v, edge_id,
                f"Vehicle weight {weight:,.0f} kg exceeds limit {max_weight:,.0f} kg on {edge_id}{bridge_flag}."
            ))
            continue

        # 4. Vehicle width exceeds road usable width (with 0.2m safety clearance)
        road_width = data.get("width_m")
        if road_width is not None and width > (road_width - 0.2):
            edges_to_remove.append((
                u, v, edge_id,
                f"Vehicle width {width:.2f} m exceeds usable roadway width {road_width:.2f} m (after 0.2m safety margin)."
            ))
            continue

        # 5. Clearance height restriction
        max_clearance = data.get("max_clearance_m")
        if vehicle_height_m is not None and max_clearance is not None and vehicle_height_m > max_clearance:
            edges_to_remove.append((
                u, v, edge_id,
                f"Vehicle height {vehicle_height_m:.2f} m exceeds overhead clearance {max_clearance:.2f} m."
            ))
            continue

        # 6. Pre-check passability safety score against minimum threshold
        safety_score, _, risk_band, _ = calculate_passability(
            vehicle_profile=vehicle_profile,
            rainfall_norm=data.get("rainfall_norm", 0.0),
            slope_norm=data.get("slope_norm", 0.0),
            landslide_risk=data.get("landslide_risk", 0.0),
            surface_damage=data.get("surface_damage", 0.0),
            narrowness_norm=data.get("narrowness_norm", 0.0),
        )

        # Store safety score on edge
        data["safety_score"] = safety_score
        data["risk_band"] = risk_band

        if safety_score < min_safety:
            edges_to_remove.append((
                u, v, edge_id,
                f"Estimated safety score {safety_score:.2f} is below minimum requirement ({min_safety:.2f}) for {vehicle_profile}."
            ))
            continue

    # Execute pruning
    for u, v, edge_id, reason in edges_to_remove:
        if pruned.has_edge(u, v):
            pruned.remove_edge(u, v)
        constraints_applied.append({
            "edge_id": edge_id,
            "from_node": u,
            "to_node": v,
            "reason": reason,
        })

    return pruned, constraints_applied

