from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from ..graph.builder import build_base_graph

router = APIRouter()


@router.get("/health")
def get_health():
    """Health check for service liveness probe."""
    return {
        "status": "healthy",
        "service": "roadsafe-routing-engine",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ready")
def get_readiness():
    """Readiness probe reporting actual loaded OSM graph metrics."""
    try:
        G = build_base_graph()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return {
        "ready": True,
        "nodes_loaded": G.number_of_nodes(),
        "edges_loaded": G.number_of_edges(),
        "algorithms": ["astar_haversine", "dijkstra", "yen_k_shortest_paths"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
