import math
from typing import List, Dict, Any, Tuple, Optional, Set
import networkx as nx
from ..passability.model import calculate_edge_cost, calculate_passability
from .turn_instructions import generate_turn_instructions


def compute_k_shortest_paths(
    graph: nx.DiGraph,
    source: str,
    target: str,
    vehicle_profile: str,
    urgency_profile: str = "standard",
    objective: str = "safest",
    k: int = 3,
) -> Tuple[List[Dict[str, Any]], float]:
    """
    Computes K loopless alternative paths using Dijkstra and penalty-based Yen deviations.
    Supports objective: "safest" vs "fastest" with configurable detour cap.
    Returns: (paths, confidence_score)
    """
    if not graph.has_node(source) or not graph.has_node(target):
        return [], 0.0

    # Extract corridor subgraph if operating on full regional network (>1000 nodes)
    active_graph = graph
    if graph.number_of_nodes() > 1000 and source in graph.nodes and target in graph.nodes:
        s_node = graph.nodes[source]
        d_node = graph.nodes[target]
        s_lat, s_lng = s_node.get("lat", 0.0), s_node.get("lng", 0.0)
        d_lat, d_lng = d_node.get("lat", 0.0), d_node.get("lng", 0.0)
        if s_lat != 0.0 and d_lat != 0.0:
            margin = 0.08  # ~9km corridor buffer
            min_lat, max_lat = min(s_lat, d_lat) - margin, max(s_lat, d_lat) + margin
            min_lng, max_lng = min(s_lng, d_lng) - margin, max(s_lng, d_lng) + margin
            corridor_nodes = [
                n for n, d in graph.nodes(data=True)
                if min_lat <= d.get("lat", 0.0) <= max_lat and min_lng <= d.get("lng", 0.0) <= max_lng
            ]
            if source in corridor_nodes and target in corridor_nodes and len(corridor_nodes) > 100:
                active_graph = graph.subgraph(corridor_nodes)

    # Compute weights and passabilities on working copy
    weighted = active_graph.copy()
    for u, v, data in weighted.edges(data=True):
        safety, _, risk_band, _ = calculate_passability(
            vehicle_profile=vehicle_profile,
            rainfall_norm=data.get("rainfall_norm") or 0.0,
            slope_norm=data.get("slope_norm") or 0.0,
            landslide_risk=data.get("landslide_risk") or 0.0,
            surface_damage=data.get("surface_damage") or 0.0,
            waterlogging_norm=data.get("waterlogging_norm") or 0.0,
            narrowness_norm=data.get("narrowness_norm") or 0.0,
        )
        data["safety_score"] = safety
        data["risk_band"] = risk_band

        total_cost, cost_bd = calculate_edge_cost(
            base_travel_time_min=data.get("base_travel_time_min", 1.0),
            safety_score=safety,
            distance_km=data.get("distance_km", 0.1),
            urgency_profile=urgency_profile,
            objective=objective,
        )
        data["weight"] = max(0.001, total_cost)
        data["cost_breakdown"] = cost_bd

    candidate_node_lists: List[List[str]] = []

    # 1. First path: absolute shortest on weighted graph
    try:
        p0 = nx.shortest_path(weighted, source, target, weight="weight")
        candidate_node_lists.append(p0)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        # Fallback to unpruned search or return empty
        return [], 0.0

    # 2. Compute K-1 diverse alternative paths via spur edge penalties
    num_alts_to_find = min(max(k, 3), 5)
    for alt_idx in range(1, num_alts_to_find):
        if not candidate_node_lists:
            break
        prev_path = candidate_node_lists[-1]
        if len(prev_path) < 2:
            break

        prev_edges = list(zip(prev_path, prev_path[1:]))
        penalized_graph = weighted.copy()

        # Penalize a portion of previous paths to force corridor deviation
        segment_len = max(2, len(prev_edges) // (alt_idx + 1))
        start_offset = (alt_idx * (len(prev_edges) // (alt_idx + 2))) % len(prev_edges)
        edges_to_penalize = prev_edges[start_offset : start_offset + segment_len]

        for u, v in edges_to_penalize:
            if penalized_graph.has_edge(u, v):
                penalized_graph[u][v]["weight"] *= 8.0

        try:
            p_alt = nx.shortest_path(penalized_graph, source, target, weight="weight")
            # Only add if sufficiently distinct (<90% edge overlap)
            p_alt_edges = set(zip(p_alt, p_alt[1:]))
            is_distinct = True
            for existing in candidate_node_lists:
                existing_edges = set(zip(existing, existing[1:]))
                overlap = len(p_alt_edges & existing_edges) / max(1, len(p_alt_edges))
                if overlap > 0.88:
                    is_distinct = False
                    break
            if is_distinct:
                candidate_node_lists.append(p_alt)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            pass

    # 3. Format candidate paths with full true curvature coordinates and edge details
    candidate_paths: List[Dict[str, Any]] = []

    for node_list in candidate_node_lists:
        total_path_cost = 0.0
        total_travel_min = 0.0
        edge_details: List[Dict[str, Any]] = []
        path_coords: List[List[float]] = []
        bottleneck_edge: Optional[Dict[str, Any]] = None
        min_safety_along_path = 1.0

        for u, v in zip(node_list, node_list[1:]):
            edata = weighted.edges[u, v]
            edge_cost = edata.get("weight", 0.0)
            total_path_cost += edge_cost
            total_travel_min += edata.get("base_travel_time_min", 0.0)

            safety = edata.get("safety_score", 1.0)
            if safety < min_safety_along_path:
                min_safety_along_path = safety
                reason = f"Safety score is {safety:.2f} due to elevated hazard conditions"
                if edata.get("landslide_risk", 0.0) > 0.4:
                    reason = f"High landslide risk corridor ({edata.get('landslide_risk'):.0%})"
                elif edata.get("rainfall_norm", 0.0) > 0.6:
                    reason = f"Heavy localized rainfall accumulation ({edata.get('rainfall_norm'):.0%})"
                elif edata.get("is_bridge"):
                    reason = "Bridge structure with restricted load parameter"

                bottleneck_edge = {
                    "edge_id": edata.get("edge_id", f"{u}->{v}"),
                    "from_node": u,
                    "to_node": v,
                    "safety_score": round(safety, 4),
                    "reason": reason,
                }

            # Concatenate real multi-point road curvature geometry
            edge_coords = edata.get("coordinates")
            if edge_coords and len(edge_coords) >= 2:
                if not path_coords:
                    path_coords.extend(edge_coords)
                else:
                    if path_coords[-1] == edge_coords[0]:
                        path_coords.extend(edge_coords[1:])
                    else:
                        path_coords.extend(edge_coords)
            else:
                if not path_coords:
                    src_n = weighted.nodes[u]
                    path_coords.append([src_n.get("lng", 0.0), src_n.get("lat", 0.0)])
                dst_n = weighted.nodes[v]
                path_coords.append([dst_n.get("lng", 0.0), dst_n.get("lat", 0.0)])

            edge_details.append({
                "edge_id": edata.get("edge_id", f"{u}->{v}"),
                "from_node": u,
                "to_node": v,
                "name": edata.get("name", f"{u}->{v}"),
                "distance_km": edata.get("distance_km", 0.0),
                "base_travel_time_min": edata.get("base_travel_time_min", 0.0),
                "safety_score": edata.get("safety_score", 1.0),
                "risk_band": edata.get("risk_band", "Green"),
                "cost_breakdown": edata.get("cost_breakdown", {}),
                "coordinates": edata.get("coordinates", []),
            })

        # Generate realistic turn-by-turn driving instructions
        instructions = generate_turn_instructions(edge_details)

        candidate_paths.append({
            "total_cost": round(total_path_cost, 4),
            "estimated_travel_minutes": round(total_travel_min, 1),
            "composite_safety_score": round(min_safety_along_path, 4),
            "hazard_exposure": round(sum((1.0 - e["safety_score"]) * max(0.05, e["distance_km"]) for e in edge_details), 4),
            "nodes": node_list,
            "edges": edge_details,
            "bottleneck": bottleneck_edge,
            "coordinates": path_coords,
            "turn_instructions": instructions,
        })

    # 4. Rank candidates according to user objective with Detour Cap
    if objective.lower() == "fastest":
        candidate_paths.sort(key=lambda p: (
            p["estimated_travel_minutes"],
            p["total_cost"]
        ))
    else:
        # Default "safest": Best safety outcome & lowest hazard exposure among feasible routes with Detour Cap
        min_eta = min(p["estimated_travel_minutes"] for p in candidate_paths)

        def safest_with_detour_cap_key(p):
            score = p["composite_safety_score"]
            is_red = score < 0.50
            tier = 1 if is_red else (3 if score >= 0.80 else 2)

            eta = p["estimated_travel_minutes"]
            extra_eta_pct = (eta - min_eta) / max(1.0, min_eta)
            absurd_detour = (extra_eta_pct > 0.35 and (eta - min_eta) > 25.0)

            effective_tier = tier
            if absurd_detour and not is_red and tier == 3:
                effective_tier = 2.5

            safety_bin = round(score, 2)
            return (-effective_tier, -safety_bin, p["hazard_exposure"], eta, p["total_cost"])

        candidate_paths.sort(key=safest_with_detour_cap_key)

    # Slice to requested k routes and assign final 1-based ranks
    paths = []
    for idx, p in enumerate(candidate_paths[:k]):
        p["rank"] = idx + 1
        paths.append(p)

    # Compute confidence score based on rank 1 separation
    confidence = 0.85
    if len(paths) >= 2:
        c1 = paths[0]["total_cost"]
        c2 = paths[1]["total_cost"]
        if c2 > 0:
            separation = max(0.0, 1.0 - (c1 / c2))
            confidence = round(min(0.98, max(0.65, 0.65 + separation * 0.33)), 4)

    return paths, confidence
