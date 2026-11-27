import os
os.environ["ROADSAFE_ALLOW_TEST_FIXTURE"] = "1"
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_and_readiness():
    res = client.get("/internal/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"

    res_ready = client.get("/internal/v1/ready")
    assert res_ready.status_code == 200
    assert res_ready.json()["ready"] is True
    assert res_ready.json()["nodes_loaded"] >= 10


def test_car_route_planning_success():
    req_payload = {
        "request_id": "test-req-car-1",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N12"},
        "vehicle": {"profile_id": "car", "weight_kg": 1800.0, "width_m": 1.8},
        "urgency_profile": "emergency",
        "k": 3,
        "incident_context": {"excluded_segment_ids": []}
    }
    res = client.post("/internal/v1/routes/compute", json=req_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "FEASIBLE"
    assert len(data["paths"]) >= 1
    assert data["confidence_score"] > 0.50
    assert "rationale" in data
    assert len(data["rationale"]) > 20

    rank1 = data["paths"][0]
    assert rank1["rank"] == 1
    assert rank1["total_cost"] > 0
    assert rank1["estimated_travel_minutes"] > 0
    assert len(rank1["edges"]) > 0
    assert len(rank1["coordinates"]) > 0


def test_heavy_truck_prunes_suspension_bridge():
    """
    Edge E16 is Umngot River Suspension Bridge with max weight 10,000 kg.
    A 16,000 kg truck MUST have E16 pruned under hard constraints.
    """
    req_payload = {
        "request_id": "test-req-truck-1",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N12"},
        "vehicle": {"profile_id": "truck", "weight_kg": 16000.0, "width_m": 2.5},
        "urgency_profile": "standard",
        "k": 3,
        "incident_context": {"excluded_segment_ids": []}
    }
    res = client.post("/internal/v1/routes/compute", json=req_payload)
    assert res.status_code == 200
    data = res.json()

    # Verify that E16 appears in constraints_applied
    pruned_edges = [c["edge_id"] for c in data["constraints_applied"]]
    assert "E16" in pruned_edges

    # Check reason mentions weight
    bridge_constraint = next(c for c in data["constraints_applied"] if c["edge_id"] == "E16")
    assert "exceeds limit" in bridge_constraint["reason"]

    # Verify no path in the result traverses E16
    for path in data["paths"]:
        for edge in path["edges"]:
            assert edge["edge_id"] != "E16"


def test_active_incident_exclusion_reroute():
    """
    When E1 is excluded via incident_context, it must be pruned and a detour taken.
    """
    req_payload = {
        "request_id": "test-req-exclusion",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N8"},
        "vehicle": {"profile_id": "ambulance", "weight_kg": 3500.0},
        "urgency_profile": "emergency",
        "k": 2,
        "incident_context": {"excluded_segment_ids": ["E1"]}
    }
    res = client.post("/internal/v1/routes/compute", json=req_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "FEASIBLE"
    assert any(c["edge_id"] == "E1" for c in data["constraints_applied"])

    # Path must detour through N9 (Smit Connector E11) instead of N2
    rank1 = data["paths"][0]
    assert "E1" not in [e["edge_id"] for e in rank1["edges"]]
    assert "N9" in rank1["nodes"]


def test_passability_analysis_monotonicity():
    """
    Increasing rainfall and landslide susceptibility must decrease safety score.
    """
    # Low hazard
    res_low = client.post("/internal/v1/passability/analyze", json={
        "segment_id": "E1",
        "vehicle_profile_id": "car",
        "features": {
            "rainfall_current_mm": 5.0,
            "rainfall_24h_mm": 10.0,
            "slope_deg": 3.0,
            "landslide_susceptibility": 0.05,
            "surface_damage": 0.05,
            "waterlogging_depth_cm": 0.0,
            "road_narrowness_m": 7.0
        }
    })
    assert res_low.status_code == 200
    score_low = res_low.json()["safety_score"]
    assert score_low >= 0.80
    assert res_low.json()["risk_band"] == "Green"

    # Severe hazard
    res_high = client.post("/internal/v1/passability/analyze", json={
        "segment_id": "E1",
        "vehicle_profile_id": "car",
        "features": {
            "rainfall_current_mm": 120.0,
            "rainfall_24h_mm": 250.0,
            "slope_deg": 28.0,
            "landslide_susceptibility": 0.85,
            "surface_damage": 0.70,
            "waterlogging_depth_cm": 35.0,
            "road_narrowness_m": 3.2
        }
    })
    assert res_high.status_code == 200
    score_high = res_high.json()["safety_score"]
    assert score_high < score_low
    assert res_high.json()["risk_band"] in ["Yellow", "Red"]


def test_no_feasible_route_when_completely_blocked():
    req_payload = {
        "request_id": "test-req-blocked",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N12"},
        "vehicle": {"profile_id": "car"},
        "urgency_profile": "standard",
        "incident_context": {"excluded_segment_ids": ["E10", "E16"]}  # Cut off all entry edges to N12
    }
    res = client.post("/internal/v1/routes/compute", json=req_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "NO_FEASIBLE_ROUTE"
    assert len(data["paths"]) == 0
    assert "NO FEASIBLE ROUTE AVAILABLE" in data["rationale"]


def test_confirmed_landslide_reroutes_truck_but_not_bike():
    """
    Deliverable 4: Unit test showing that a confirmed landslide on edge E1
    prunes/reroutes a truck (due to vehicle width, weight, and landslide sensitivity),
    while a nimble bike can still traverse E1.
    """
    hazard_payload = [
        {
            "edge_id": "E1",
            "hazard_type": "landslide",
            "severity": "high",
            "status": "confirmed",
            "confirm_count": 3,
            "clear_count": 0,
            "decay_factor": 1.0,
        }
    ]

    # 1. Truck route request
    truck_res = client.post("/internal/v1/routes/compute", json={
        "request_id": "test-truck-landslide",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N8"},
        "vehicle": {"profile_id": "truck", "weight_kg": 15000.0, "width_m": 2.6},
        "urgency_profile": "standard",
        "objective": "safest",
        "hazard_context": hazard_payload,
    })
    assert truck_res.status_code == 200
    truck_data = truck_res.json()
    assert truck_data["status"] == "FEASIBLE"
    # Truck must have E1 pruned in constraints_applied
    pruned_edges_truck = [c["edge_id"] for c in truck_data["constraints_applied"]]
    assert "E1" in pruned_edges_truck
    # Truck's chosen path must NOT contain E1 (must detour via Smit E11)
    for edge in truck_data["paths"][0]["edges"]:
        assert edge["edge_id"] != "E1"
    assert "N9" in truck_data["paths"][0]["nodes"]

    # 2. Bike route request on the same network with the same confirmed landslide
    bike_res = client.post("/internal/v1/routes/compute", json={
        "request_id": "test-bike-landslide",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N8"},
        "vehicle": {"profile_id": "bike", "weight_kg": 200.0, "width_m": 0.9},
        "urgency_profile": "standard",
        "objective": "fastest",
        "hazard_context": hazard_payload,
    })
    assert bike_res.status_code == 200
    bike_data = bike_res.json()
    assert bike_data["status"] == "FEASIBLE"
    # Bike must NOT have E1 pruned
    pruned_edges_bike = [c["edge_id"] for c in bike_data["constraints_applied"]]
    assert "E1" not in pruned_edges_bike
    # Bike rank 1 path uses E1 directly because bike can navigate the narrow passage
    bike_edges = [e["edge_id"] for e in bike_data["paths"][0]["edges"]]
    assert "E1" in bike_edges


def test_unverified_report_applies_mild_penalty_without_hard_close():
    """
    An unverified report must NOT prune the edge, but slightly lower safety / increase cost.
    """
    req_clean = {
        "request_id": "test-clean",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N2"},
        "vehicle": {"profile_id": "car"},
        "hazard_context": [],
    }
    res_clean = client.post("/internal/v1/routes/compute", json=req_clean)
    assert res_clean.status_code == 200
    clean_cost = res_clean.json()["paths"][0]["total_cost"]

    req_unverified = {
        "request_id": "test-unverified",
        "source": {"node_id": "N1"},
        "destination": {"node_id": "N2"},
        "vehicle": {"profile_id": "car"},
        "hazard_context": [
            {
                "edge_id": "E1",
                "hazard_type": "landslide",
                "severity": "medium",
                "status": "unverified",
                "confirm_count": 1,
                "decay_factor": 1.0,
            }
        ],
    }
    res_unverified = client.post("/internal/v1/routes/compute", json=req_unverified)
    assert res_unverified.status_code == 200
    unv_data = res_unverified.json()
    assert unv_data["status"] == "FEASIBLE"
    # E1 is NOT pruned
    assert not any(c["edge_id"] == "E1" for c in unv_data["constraints_applied"])
    # Path still traverses E1 but with a mildly higher cost
    unv_cost = res_unverified.json()["paths"][0]["total_cost"]
    assert unv_cost > clean_cost


def test_fastest_vs_safest_diverges_when_hazard_on_fastest_route():
    """
    Isolated test fixture:
    - Fastest path N1 -> N8 via E1 (short, fast) has an active flooded_road hazard (Yellow/Red).
    - Alternative path N1 -> N9 -> N8 via E11, E12 (longer) has no hazards (Green).
    Under objective='fastest', Rank 1 picks the shortest travel time (via E1).
    Under objective='safest', Rank 1 avoids the hazard and picks the safer corridor (via N9).
    """
    hazard = [
        {
            "edge_id": "E1",
            "hazard_type": "flooded_road",
            "severity": "high",
            "status": "confirmed",
            "confirm_count": 3,
            "decay_factor": 1.0,
        }
    ]
    fastest_res = client.post(
        "/internal/v1/routes/compute",
        json={
            "request_id": "test-fastest-vs-safest-fast",
            "source": {"node_id": "N1"},
            "destination": {"node_id": "N8"},
            "vehicle": {"profile_id": "car"},
            "objective": "fastest",
            "k": 3,
            "hazard_context": hazard,
        },
    )
    assert fastest_res.status_code == 200
    fastest_edges = [e["edge_id"] for e in fastest_res.json()["paths"][0]["edges"]]

    safest_res = client.post(
        "/internal/v1/routes/compute",
        json={
            "request_id": "test-fastest-vs-safest-safe",
            "source": {"node_id": "N1"},
            "destination": {"node_id": "N8"},
            "vehicle": {"profile_id": "car"},
            "objective": "safest",
            "k": 3,
            "hazard_context": hazard,
        },
    )
    assert safest_res.status_code == 200
    safest_edges = [e["edge_id"] for e in safest_res.json()["paths"][0]["edges"]]

    assert "E1" in fastest_edges, "Fastest mode must optimize travel time without hazard penalty"
    assert "E1" not in safest_edges, "Safest mode must avoid the flooded fastest edge when a safer alternative exists"


def test_fastest_and_safest_agree_when_no_relevant_hazards():
    """
    When no hazards exist on the fastest clean corridor (N1 -> N2),
    both fastest and safest legitimately return the same optimal route.
    """
    fast = client.post(
        "/internal/v1/routes/compute",
        json={"request_id": "t-agree-f", "source": {"node_id": "N1"}, "destination": {"node_id": "N2"}, "vehicle": {"profile_id": "car"}, "objective": "fastest"},
    ).json()
    safe = client.post(
        "/internal/v1/routes/compute",
        json={"request_id": "t-agree-s", "source": {"node_id": "N1"}, "destination": {"node_id": "N2"}, "vehicle": {"profile_id": "car"}, "objective": "safest"},
    ).json()
    assert fast["paths"][0]["nodes"] == safe["paths"][0]["nodes"]



