import os
import json
import pickle
import math
from typing import List, Dict, Any, Tuple, Optional
import networkx as nx

# Seeded demo road network fallback & pilot corridor hub aliases
SEEDED_NODES: List[Dict[str, Any]] = [
    {"id": "N1", "name": "Shillong Command HQ (Police Bazar)", "lat": 25.5788, "lng": 91.8933, "elevation_m": 1520, "is_hub": True},
    {"id": "N2", "name": "Upper Shillong Depot", "lat": 25.5450, "lng": 91.8600, "elevation_m": 1650, "is_hub": True},
    {"id": "N3", "name": "Mylliem Junction", "lat": 25.5140, "lng": 91.8540, "elevation_m": 1700, "is_hub": False},
    {"id": "N4", "name": "Mawphlang Heritage Post", "lat": 25.4450, "lng": 91.7580, "elevation_m": 1820, "is_hub": False},
    {"id": "N5", "name": "Weiloi Gorge Crossing", "lat": 25.3520, "lng": 91.6850, "elevation_m": 1400, "is_hub": False},
    {"id": "N6", "name": "Mawsynram Station", "lat": 25.2970, "lng": 91.5820, "elevation_m": 1400, "is_hub": False},
    {"id": "N7", "name": "Cherrapunji (Sohra) Base", "lat": 25.2815, "lng": 91.7166, "elevation_m": 1430, "is_hub": True},
    {"id": "N8", "name": "Laitlyngkot Ridge", "lat": 25.4370, "lng": 91.8340, "elevation_m": 1750, "is_hub": False},
    {"id": "N9", "name": "Smit Relief Hub", "lat": 25.5310, "lng": 91.9280, "elevation_m": 1600, "is_hub": True},
    {"id": "N10", "name": "Pynursla Pass", "lat": 25.3050, "lng": 91.8940, "elevation_m": 1450, "is_hub": False},
    {"id": "N11", "name": "Pongtung Village", "lat": 25.2500, "lng": 91.9500, "elevation_m": 900, "is_hub": False},
    {"id": "N12", "name": "Dawki Border Post", "lat": 25.1850, "lng": 92.0150, "elevation_m": 120, "is_hub": True},
]

SEEDED_EDGES: List[Dict[str, Any]] = [
    {
        "id": "E1", "from": "N1", "to": "N2", "name": "NH-06 Shillong City Arterial",
        "distance_km": 8.0, "travel_time_min": 18.0, "road_class": "highway", "width_m": 8.0,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.15, "slope_norm": 0.20, "landslide_risk": 0.05, "surface_damage": 0.10, "narrowness_norm": 0.10,
        "coordinates": [[91.8933, 25.5788], [91.8800, 25.5600], [91.8600, 25.5450]]
    },
    {
        "id": "E2", "from": "N2", "to": "N3", "name": "NH-06 Mylliem Approach",
        "distance_km": 7.5, "travel_time_min": 15.0, "road_class": "highway", "width_m": 7.5,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.25, "slope_norm": 0.35, "landslide_risk": 0.12, "surface_damage": 0.15, "narrowness_norm": 0.15,
        "coordinates": [[91.8600, 25.5450], [91.8570, 25.5300], [91.8540, 25.5140]]
    },
    {
        "id": "E3", "from": "N3", "to": "N4", "name": "SH-5 Mawphlang Valley Corridor",
        "distance_km": 14.0, "travel_time_min": 28.0, "road_class": "secondary", "width_m": 6.0,
        "max_weight_kg": 25000.0, "max_clearance_m": 4.2, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.45, "slope_norm": 0.50, "landslide_risk": 0.30, "surface_damage": 0.25, "narrowness_norm": 0.35,
        "coordinates": [[91.8540, 25.5140], [91.8100, 25.4800], [91.7580, 25.4450]]
    },
    {
        "id": "E4", "from": "N4", "to": "N5", "name": "SH-5 Weiloi Link",
        "distance_km": 15.0, "travel_time_min": 32.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 20000.0, "max_clearance_m": 4.0, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.55, "slope_norm": 0.65, "landslide_risk": 0.40, "surface_damage": 0.35, "narrowness_norm": 0.45,
        "coordinates": [[91.7580, 25.4450], [91.7200, 25.4000], [91.6850, 25.3520]]
    },
    {
        "id": "E5", "from": "N5", "to": "N6", "name": "Mawsynram Heavy Rain Route",
        "distance_km": 18.0, "travel_time_min": 45.0, "road_class": "rural", "width_m": 4.5,
        "max_weight_kg": 12000.0, "max_clearance_m": 3.6, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.90, "slope_norm": 0.70, "landslide_risk": 0.65, "surface_damage": 0.50, "narrowness_norm": 0.60,
        "coordinates": [[91.6850, 25.3520], [91.6300, 25.3200], [91.5820, 25.2970]]
    },
    {
        "id": "E6", "from": "N5", "to": "N7", "name": "Sohra West Mountain Route",
        "distance_km": 20.0, "travel_time_min": 48.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 20000.0, "max_clearance_m": 4.0, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.70, "slope_norm": 0.75, "landslide_risk": 0.50, "surface_damage": 0.40, "narrowness_norm": 0.45,
        "coordinates": [[91.6850, 25.3520], [91.7000, 25.3100], [91.7166, 25.2815]]
    },
    {
        "id": "E7", "from": "N3", "to": "N8", "name": "NH-06 Laitlyngkot Ridge Highway",
        "distance_km": 13.0, "travel_time_min": 24.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.30, "slope_norm": 0.40, "landslide_risk": 0.15, "surface_damage": 0.10, "narrowness_norm": 0.20,
        "coordinates": [[91.8540, 25.5140], [91.8440, 25.4800], [91.8340, 25.4370]]
    },
    {
        "id": "E8", "from": "N8", "to": "N10", "name": "NH-06 Pynursla High Landslide Pass",
        "distance_km": 19.0, "travel_time_min": 42.0, "road_class": "highway", "width_m": 6.5,
        "max_weight_kg": 30000.0, "max_clearance_m": 4.2, "is_bridge": False, "status": "caution",
        "rainfall_norm": 0.75, "slope_norm": 0.80, "landslide_risk": 0.70, "surface_damage": 0.60, "narrowness_norm": 0.30,
        "coordinates": [[91.8340, 25.4370], [91.8600, 25.3700], [91.8940, 25.3050]]
    },
    {
        "id": "E9", "from": "N10", "to": "N11", "name": "NH-06 Pongtung Descent",
        "distance_km": 12.0, "travel_time_min": 22.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.35, "slope_norm": 0.50, "landslide_risk": 0.20, "surface_damage": 0.20, "narrowness_norm": 0.20,
        "coordinates": [[91.8940, 25.3050], [91.9200, 25.2750], [91.9500, 25.2500]]
    },
    {
        "id": "E10", "from": "N11", "to": "N12", "name": "Dawki Valley Gateway",
        "distance_km": 14.0, "travel_time_min": 28.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.20, "slope_norm": 0.30, "landslide_risk": 0.10, "surface_damage": 0.15, "narrowness_norm": 0.20,
        "coordinates": [[91.9500, 25.2500], [91.9800, 25.2200], [92.0150, 25.1850]]
    },
    {
        "id": "E11", "from": "N1", "to": "N9", "name": "Smit Eastern Connector",
        "distance_km": 16.0, "travel_time_min": 32.0, "road_class": "secondary", "width_m": 6.0,
        "max_weight_kg": 25000.0, "max_clearance_m": 4.2, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.20, "slope_norm": 0.30, "landslide_risk": 0.10, "surface_damage": 0.15, "narrowness_norm": 0.30,
        "coordinates": [[91.8933, 25.5788], [91.9100, 25.5500], [91.9280, 25.5310]]
    },
    {
        "id": "E12", "from": "N9", "to": "N8", "name": "Smit-Laitlyngkot Relief Cutoff",
        "distance_km": 15.0, "travel_time_min": 36.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 18000.0, "max_clearance_m": 4.0, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.35, "slope_norm": 0.45, "landslide_risk": 0.25, "surface_damage": 0.25, "narrowness_norm": 0.40,
        "coordinates": [[91.9280, 25.5310], [91.8800, 25.4800], [91.8340, 25.4370]]
    },
    {
        "id": "E13", "from": "N4", "to": "N7", "name": "Cherrapunji Scenic Detour (Steep)",
        "distance_km": 25.0, "travel_time_min": 60.0, "road_class": "rural", "width_m": 4.0,
        "max_weight_kg": 8000.0, "max_clearance_m": 3.4, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.80, "slope_norm": 0.85, "landslide_risk": 0.65, "surface_damage": 0.45, "narrowness_norm": 0.70,
        "coordinates": [[91.7580, 25.4450], [91.7300, 25.3600], [91.7166, 25.2815]]
    },
    {
        "id": "E14", "from": "N2", "to": "N8", "name": "Upper Shillong Bypass Expressway",
        "distance_km": 18.0, "travel_time_min": 32.0, "road_class": "highway", "width_m": 8.0,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.20, "slope_norm": 0.25, "landslide_risk": 0.08, "surface_damage": 0.10, "narrowness_norm": 0.10,
        "coordinates": [[91.8600, 25.5450], [91.8470, 25.4900], [91.8340, 25.4370]]
    },
    {
        "id": "E15", "from": "N8", "to": "N7", "name": "Laitlyngkot-Sohra Direct Shortcut",
        "distance_km": 24.0, "travel_time_min": 52.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 16000.0, "max_clearance_m": 3.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.60, "slope_norm": 0.60, "landslide_risk": 0.45, "surface_damage": 0.30, "narrowness_norm": 0.40,
        "coordinates": [[91.8340, 25.4370], [91.7700, 25.3500], [91.7166, 25.2815]]
    },
    {
        "id": "E16", "from": "N10", "to": "N12", "name": "Umngot River Suspension Bridge",
        "distance_km": 28.0, "travel_time_min": 55.0, "road_class": "highway", "width_m": 5.0,
        "max_weight_kg": 10000.0,  # CRITICAL BRIDGE LOAD LIMIT: 10 tonnes max
        "max_clearance_m": 3.8, "is_bridge": True, "status": "open",
        "rainfall_norm": 0.40, "slope_norm": 0.30, "landslide_risk": 0.20, "surface_damage": 0.15, "narrowness_norm": 0.50,
        "coordinates": [[91.8940, 25.3050], [91.9500, 25.2400], [92.0150, 25.1850]]
    },
    {
        "id": "E17", "from": "N7", "to": "N10", "name": "Sohra to Pynursla Cross-Link",
        "distance_km": 22.0, "travel_time_min": 45.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 20000.0, "max_clearance_m": 4.0, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.50, "slope_norm": 0.55, "landslide_risk": 0.35, "surface_damage": 0.25, "narrowness_norm": 0.40,
        "coordinates": [[91.7166, 25.2815], [91.8000, 25.2900], [91.8940, 25.3050]]
    },
    # Reverse directions
    {
        "id": "E1_rev", "from": "N2", "to": "N1", "name": "NH-06 Shillong City (Northbound)",
        "distance_km": 8.0, "travel_time_min": 18.0, "road_class": "highway", "width_m": 8.0,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.15, "slope_norm": 0.20, "landslide_risk": 0.05, "surface_damage": 0.10, "narrowness_norm": 0.10,
        "coordinates": [[91.8600, 25.5450], [91.8800, 25.5600], [91.8933, 25.5788]]
    },
    {
        "id": "E2_rev", "from": "N3", "to": "N2", "name": "NH-06 Mylliem Approach (Northbound)",
        "distance_km": 7.5, "travel_time_min": 15.0, "road_class": "highway", "width_m": 7.5,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.25, "slope_norm": 0.35, "landslide_risk": 0.12, "surface_damage": 0.15, "narrowness_norm": 0.15,
        "coordinates": [[91.8540, 25.5140], [91.8570, 25.5300], [91.8600, 25.5450]]
    },
    {
        "id": "E7_rev", "from": "N8", "to": "N3", "name": "NH-06 Laitlyngkot (Northbound)",
        "distance_km": 13.0, "travel_time_min": 24.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.30, "slope_norm": 0.40, "landslide_risk": 0.15, "surface_damage": 0.10, "narrowness_norm": 0.20,
        "coordinates": [[91.8340, 25.4370], [91.8440, 25.4800], [91.8540, 25.5140]]
    },
    {
        "id": "E8_rev", "from": "N10", "to": "N8", "name": "NH-06 Pynursla Pass (Northbound)",
        "distance_km": 19.0, "travel_time_min": 42.0, "road_class": "highway", "width_m": 6.5,
        "max_weight_kg": 30000.0, "max_clearance_m": 4.2, "is_bridge": False, "status": "caution",
        "rainfall_norm": 0.75, "slope_norm": 0.80, "landslide_risk": 0.70, "surface_damage": 0.60, "narrowness_norm": 0.30,
        "coordinates": [[91.8940, 25.3050], [91.8600, 25.3700], [91.8340, 25.4370]]
    },
    {
        "id": "E9_rev", "from": "N11", "to": "N10", "name": "NH-06 Pongtung (Ascent)",
        "distance_km": 12.0, "travel_time_min": 26.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.35, "slope_norm": 0.50, "landslide_risk": 0.20, "surface_damage": 0.20, "narrowness_norm": 0.20,
        "coordinates": [[91.9500, 25.2500], [91.9200, 25.2750], [91.8940, 25.3050]]
    },
    {
        "id": "E10_rev", "from": "N12", "to": "N11", "name": "Dawki Gateway (Northbound)",
        "distance_km": 14.0, "travel_time_min": 32.0, "road_class": "highway", "width_m": 7.0,
        "max_weight_kg": 35000.0, "max_clearance_m": 4.5, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.20, "slope_norm": 0.30, "landslide_risk": 0.10, "surface_damage": 0.15, "narrowness_norm": 0.20,
        "coordinates": [[92.0150, 25.1850], [91.9800, 25.2200], [91.9500, 25.2500]]
    },
    {
        "id": "E14_rev", "from": "N8", "to": "N2", "name": "Upper Shillong Bypass (Northbound)",
        "distance_km": 18.0, "travel_time_min": 32.0, "road_class": "highway", "width_m": 8.0,
        "max_weight_kg": 40000.0, "max_clearance_m": 4.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.20, "slope_norm": 0.25, "landslide_risk": 0.08, "surface_damage": 0.10, "narrowness_norm": 0.10,
        "coordinates": [[91.8340, 25.4370], [91.8470, 25.4900], [91.8600, 25.5450]]
    },
    {
        "id": "E15_rev", "from": "N7", "to": "N8", "name": "Sohra-Laitlyngkot Return",
        "distance_km": 24.0, "travel_time_min": 52.0, "road_class": "secondary", "width_m": 5.5,
        "max_weight_kg": 16000.0, "max_clearance_m": 3.8, "is_bridge": False, "status": "open",
        "rainfall_norm": 0.60, "slope_norm": 0.60, "landslide_risk": 0.45, "surface_damage": 0.30, "narrowness_norm": 0.40,
        "coordinates": [[91.7166, 25.2815], [91.7700, 25.3500], [91.8340, 25.4370]]
    },
    {
        "id": "E16_rev", "from": "N12", "to": "N10", "name": "Umngot River Suspension Bridge (Ascent)",
        "distance_km": 28.0, "travel_time_min": 55.0, "road_class": "highway", "width_m": 5.0,
        "max_weight_kg": 10000.0,
        "max_clearance_m": 3.8, "is_bridge": True, "status": "open",
        "rainfall_norm": 0.40, "slope_norm": 0.30, "landslide_risk": 0.20, "surface_damage": 0.15, "narrowness_norm": 0.50,
        "coordinates": [[92.0150, 25.1850], [91.9500, 25.2400], [91.8940, 25.3050]]
    },
]

_CACHED_BASE_GRAPH: Optional[nx.DiGraph] = None


def get_base_data_paths() -> Tuple[str, str]:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    app_dir = os.path.dirname(current_dir)
    engine_dir = os.path.dirname(app_dir)
    data_dir = os.path.join(engine_dir, "data")
    pickle_path = os.path.join(data_dir, "meghalaya_osm_graph.pickle")
    json_path = os.path.join(data_dir, "meghalaya_osm_network.json")
    return pickle_path, json_path


def load_cached_osm_graph() -> Optional[nx.DiGraph]:
    """Loads pre-built OpenStreetMap graph and augments with corridor aliases."""
    global _CACHED_BASE_GRAPH
    if _CACHED_BASE_GRAPH is not None:
        return _CACHED_BASE_GRAPH

    pickle_path, json_path = get_base_data_paths()
    G: Optional[nx.DiGraph] = None

    if (os.path.exists(pickle_path) and os.path.getsize(pickle_path) > 1024) or os.path.exists(pickle_path + ".gz"):
        try:
            if os.path.exists(pickle_path) and os.path.getsize(pickle_path) > 1024:
                with open(pickle_path, "rb") as pf:
                    G = pickle.load(pf)
            else:
                import gzip
                with gzip.open(pickle_path + ".gz", "rb") as pf:
                    G = pickle.load(pf)
        except Exception as e:
            print(f"Warning: Failed loading graph pickle: {e}")

    if G is None:
        target_json = json_path if os.path.exists(json_path) else (json_path + ".gz" if os.path.exists(json_path + ".gz") else None)
        if target_json:
            try:
                if target_json.endswith(".gz"):
                    import gzip
                    with gzip.open(target_json, "rt", encoding="utf-8") as f:
                        data = json.load(f)
                else:
                    with open(target_json, "r") as f:
                        data = json.load(f)

                G = nx.DiGraph()
                for n in data["nodes"]:
                    G.add_node(
                        str(n["id"]),
                        name=n.get("name", str(n["id"])),
                        lat=float(n.get("lat", 0.0)),
                        lng=float(n.get("lng", 0.0)),
                        elevation_m=float(n.get("elevation_m", 0.0)),
                        is_hub=bool(n.get("is_hub", False)),
                    )
                for e in data["edges"]:
                    G.add_edge(
                        str(e["from"]),
                        str(e["to"]),
                        edge_id=e.get("id"),
                        name=e.get("name", e.get("id")),
                        distance_km=float(e.get("distance_km", 0.0)),
                        base_travel_time_min=float(e.get("travel_time_min", 0.0)),
                        speed_limit_kmh=float(e.get("speed_limit_kmh", 50.0)),
                        hazard_count=int(e.get("hazard_count", 0)),
                        road_class=e.get("road_class", "secondary"),
                        osm_way_id=str(e.get("osm_way_id", "")),
                        geometry=e.get("geometry", []),
                        width_m=float(e.get("width_m", 6.0)),
                        max_weight_kg=float(e.get("max_weight_kg", 30000.0)),
                        max_clearance_m=float(e.get("max_clearance_m", 4.2)),
                        is_bridge=bool(e.get("is_bridge", False)),
                        is_tunnel=bool(e.get("is_tunnel", False)),
                        status=e.get("status", "open"),
                        rainfall_norm=float(e.get("rainfall_norm", 0.0)),
                        slope_norm=float(e.get("slope_norm", 0.0)),
                        landslide_risk=float(e.get("landslide_risk", 0.0)),
                        surface_damage=float(e.get("surface_damage", 0.0)),
                        narrowness_norm=float(e.get("narrowness_norm", 0.0)),
                        coordinates=e.get("coordinates", []),
                    )
            except Exception as e:
                print(f"Warning: Failed loading graph json: {e}")

    if G is not None:
        # 1. Critical topological digitizing bridges
        G.add_edge("3524101800", "9662084265", distance_km=0.024, base_travel_time_min=0.03, weight=0.024, name="Junction Link", road_class="residential", coordinates=[[91.777705, 25.419748], [91.777523, 25.419863]])
        G.add_edge("9662084265", "3524101800", distance_km=0.024, base_travel_time_min=0.03, weight=0.024, name="Junction Link", road_class="residential", coordinates=[[91.777523, 25.419863], [91.777705, 25.419748]])

        # 2. Add seeded nodes and edges so N1..N12 and E1..E17 resolve seamlessly
        for n in SEEDED_NODES:
            if n["id"] not in G.nodes:
                G.add_node(
                    str(n["id"]),
                    name=n.get("name", str(n["id"])),
                    lat=float(n.get("lat", 0.0)),
                    lng=float(n.get("lng", 0.0)),
                    elevation_m=float(n.get("elevation_m", 0.0)),
                    is_hub=bool(n.get("is_hub", False)),
                )
        for e in SEEDED_EDGES:
            u, v = str(e["from"]), str(e["to"])
            G.add_edge(
                u, v,
                edge_id=e.get("id"),
                name=e.get("name", e.get("id")),
                distance_km=float(e.get("distance_km", 5.0)),
                base_travel_time_min=float(e.get("travel_time_min", 10.0)),
                road_class=e.get("road_class", "secondary"),
                width_m=float(e.get("width_m", 6.0)),
                max_weight_kg=float(e.get("max_weight_kg", 30000.0)),
                max_clearance_m=float(e.get("max_clearance_m", 4.2)),
                is_bridge=bool(e.get("is_bridge", False)),
                is_tunnel=bool(e.get("is_tunnel", False)),
                status=e.get("status", "open"),
                rainfall_norm=float(e.get("rainfall_norm", 0.0)),
                slope_norm=float(e.get("slope_norm", 0.0)),
                landslide_risk=float(e.get("landslide_risk", 0.0)),
                surface_damage=float(e.get("surface_damage", 0.0)),
                narrowness_norm=float(e.get("narrowness_norm", 0.0)),
                coordinates=e.get("coordinates", []),
            )

        _CACHED_BASE_GRAPH = G
        return _CACHED_BASE_GRAPH

    return None


def build_base_graph(
    custom_nodes: Optional[List[Dict[str, Any]]] = None,
    custom_edges: Optional[List[Dict[str, Any]]] = None,
) -> nx.DiGraph:
    """
    Constructs a NetworkX directed graph from OSM cache or custom definitions.
    """
    if custom_nodes is None and custom_edges is None:
        osm_graph = load_cached_osm_graph()
        if osm_graph is not None:
            return osm_graph

    nodes = custom_nodes if custom_nodes is not None else SEEDED_NODES
    edges = custom_edges if custom_edges is not None else SEEDED_EDGES

    G = nx.DiGraph()
    for n in nodes:
        G.add_node(
            str(n["id"]),
            name=n.get("name", str(n["id"])),
            lat=n.get("lat", 0.0),
            lng=n.get("lng", 0.0),
            elevation_m=n.get("elevation_m", 0.0),
            is_hub=n.get("is_hub", False),
        )

    for e in edges:
        u = str(e["from"])
        v = str(e["to"])
        edge_id = str(e.get("id", f"{u}->{v}"))
        coords = e.get("coordinates")
        if not coords and u in G.nodes and v in G.nodes:
            coords = [
                [G.nodes[u]["lng"], G.nodes[u]["lat"]],
                [G.nodes[v]["lng"], G.nodes[v]["lat"]],
            ]

        G.add_edge(
            u,
            v,
            edge_id=edge_id,
            name=e.get("name", edge_id),
            distance_km=float(e.get("distance_km", 5.0)),
            base_travel_time_min=float(e.get("travel_time_min", 10.0)),
            road_class=e.get("road_class", "secondary"),
            width_m=float(e.get("width_m", 6.0)),
            max_weight_kg=float(e.get("max_weight_kg", 30000.0)),
            max_clearance_m=float(e.get("max_clearance_m", 4.2)),
            is_bridge=bool(e.get("is_bridge", False)),
            is_tunnel=bool(e.get("is_tunnel", False)),
            status=e.get("status", "open"),
            rainfall_norm=float(e.get("rainfall_norm", 0.0)),
            slope_norm=float(e.get("slope_norm", 0.0)),
            landslide_risk=float(e.get("landslide_risk", 0.0)),
            surface_damage=float(e.get("surface_damage", 0.0)),
            narrowness_norm=float(e.get("narrowness_norm", 0.0)),
            coordinates=coords or [],
        )

    return G
