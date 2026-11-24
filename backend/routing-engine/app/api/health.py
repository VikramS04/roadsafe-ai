from datetime import datetime, timezone
from fastapi import APIRouter

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
    """Readiness probe checking memory graph availability."""
    from ..graph.builder import SEEDED_NODES, SEEDED_EDGES
    return {
        "ready": True,
        "nodes_loaded": len(SEEDED_NODES),
        "edges_loaded": len(SEEDED_EDGES),
        "algorithms": ["dijkstra", "yen_k_shortest_paths"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

