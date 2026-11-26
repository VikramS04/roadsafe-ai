from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from ..schemas.requests import RouteComputeRequest
from ..schemas.responses import (
    RouteComputeResponse,
    RoutePath,
    RouteEdgeDetail,
    Bottleneck,
    ConstraintApplied,
    DataQuality,
    CostBreakdown,
)
from ..graph.builder import build_base_graph
from ..graph.pruning import prune_graph_hard_constraints
from ..algorithms.yen import compute_k_shortest_paths
from ..explainability.rationale import generate_structured_rationale

router = APIRouter()


@router.post("/compute", response_model=RouteComputeResponse)
def compute_route(req: RouteComputeRequest):
    """
    Computes vehicle-aware emergency routes with hard constraints,
    Yen's K-shortest paths, bottleneck analysis, and fact-grounded rationale.
    """
    try:
        base_graph = build_base_graph()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # Resolve source and target node IDs (no hardcoded N1/N12 defaults)
    if not req.source.node_id or not req.destination.node_id:
        raise HTTPException(status_code=400, detail="Both source.node_id and destination.node_id are required.")
    src_node = req.source.node_id
    dst_node = req.destination.node_id

    v_profile = req.vehicle.profile_id or "car"
    excluded_edges = req.incident_context.excluded_segment_ids if req.incident_context else []
    hazards_data = [h.model_dump() for h in req.hazard_context] if req.hazard_context else []

    # 0. Corridor Bounding-Box Clipping (for sub-second routing on full regional OSM network)
    active_graph = base_graph
    if base_graph.number_of_nodes() > 1000 and src_node in base_graph.nodes and dst_node in base_graph.nodes:
        s_node = base_graph.nodes[src_node]
        d_node = base_graph.nodes[dst_node]
        s_lat = req.source.lat or s_node.get("lat", 0.0)
        s_lng = req.source.lng or s_node.get("lng", 0.0)
        d_lat = req.destination.lat or d_node.get("lat", 0.0)
        d_lng = req.destination.lng or d_node.get("lng", 0.0)
        if s_lat != 0.0 and d_lat != 0.0:
            margin = 0.08  # ~9km corridor margin
            min_lat, max_lat = min(s_lat, d_lat) - margin, max(s_lat, d_lat) + margin
            min_lng, max_lng = min(s_lng, d_lng) - margin, max(s_lng, d_lng) + margin
            corridor_nodes = [
                n for n, d in base_graph.nodes(data=True)
                if min_lat <= d.get("lat", 0.0) <= max_lat and min_lng <= d.get("lng", 0.0) <= max_lng
            ]
            if src_node in corridor_nodes and dst_node in corridor_nodes and len(corridor_nodes) > 100:
                active_graph = base_graph.subgraph(corridor_nodes).copy()

    # 1. Apply hard constraints and prune forbidden edges on active subgraph
    pruned_graph, constraints_applied = prune_graph_hard_constraints(
        graph=active_graph,
        vehicle_profile=v_profile,
        vehicle_weight_kg=req.vehicle.weight_kg,
        vehicle_width_m=req.vehicle.width_m,
        vehicle_height_m=req.vehicle.height_m,
        min_safety_score=req.vehicle.min_safety_score,
        excluded_segment_ids=excluded_edges,
        hazard_context=hazards_data,
    )

    # 2. Compute K-shortest loopless paths using Yen's algorithm
    raw_paths, confidence = compute_k_shortest_paths(
        graph=pruned_graph,
        source=src_node,
        target=dst_node,
        vehicle_profile=v_profile,
        urgency_profile=req.urgency_profile,
        objective=req.objective,
        k=req.k,
    )

    # 3. Generate structured rationale
    rationale = generate_structured_rationale(
        paths=raw_paths,
        constraints_applied=constraints_applied,
        vehicle_profile=v_profile,
        urgency_profile=req.urgency_profile,
        confidence=confidence,
    )

    # 4. Format paths into response schemas
    formatted_paths: list[RoutePath] = []
    for p in raw_paths:
        edges_out: list[RouteEdgeDetail] = []
        for e in p["edges"]:
            cbd = CostBreakdown(**e["cost_breakdown"])
            edges_out.append(
                RouteEdgeDetail(
                    edge_id=e["edge_id"],
                    from_node=e["from_node"],
                    to_node=e["to_node"],
                    name=e["name"],
                    distance_km=e["distance_km"],
                    base_travel_time_min=e["base_travel_time_min"],
                    safety_score=e["safety_score"],
                    risk_band=e["risk_band"],
                    cost_breakdown=cbd,
                    coordinates=e.get("coordinates"),
                )
            )

        bn = Bottleneck(**p["bottleneck"]) if p.get("bottleneck") else None

        formatted_paths.append(
            RoutePath(
                rank=p["rank"],
                total_cost=p["total_cost"],
                estimated_travel_minutes=p["estimated_travel_minutes"],
                composite_safety_score=p["composite_safety_score"],
                nodes=p["nodes"],
                edges=edges_out,
                bottleneck=bn,
                coordinates=p.get("coordinates", []),
                turn_instructions=p.get("turn_instructions"),
            )
        )

    status_str = "FEASIBLE" if formatted_paths else "NO_FEASIBLE_ROUTE"

    constraints_out = [ConstraintApplied(**c) for c in constraints_applied]

    data_quality = DataQuality(
        stale_hazards=False,
        freshness_timestamp=datetime.now(timezone.utc).isoformat(),
        confidence_discount_applied=0.0,
        source="OpenStreetMap (© OpenStreetMap contributors) - East Khasi Hills Road Network",
    )

    return RouteComputeResponse(
        request_id=req.request_id,
        status=status_str,
        constraints_applied=constraints_out,
        paths=formatted_paths,
        confidence_score=confidence,
        rationale=rationale,
        data_quality=data_quality,
    )

