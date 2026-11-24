import os
import sys
import math
import time
import json
import urllib.request
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Tuple, Set

# Pilot Area Bounding Boxes covering:
# Shillong, Mawphlang, Cherrapunji (Sohra), Pynursla, Dawki, Mawsynram
PILOT_TILES = [
    # Shillong Urban & Arterials
    ("Shillong_North", 91.85, 25.56, 91.93, 25.62),
    ("Shillong_Central", 91.86, 25.52, 91.91, 25.56),
    ("Upper_Shillong", 91.82, 25.50, 91.88, 25.55),
    # NH-06 & SH-5 Junctions (Mylliem & Mawphlang Corridor)
    ("Mylliem_Mawphlang_Link", 91.78, 25.46, 91.86, 25.52),
    ("Mawphlang_Sacred_Grove", 91.72, 25.42, 91.79, 25.47),
    # SH-5 Weiloi Gorge & Mawsynram Link
    ("Weiloi_Crossing", 91.66, 25.33, 91.74, 25.42),
    ("Mawsynram_Corridor", 91.56, 25.26, 91.66, 25.35),
    # Cherrapunji / Sohra Mountain Routes
    ("Sohra_North", 91.68, 25.28, 91.75, 25.34),
    ("Sohra_Central", 91.69, 25.23, 91.75, 25.28),
    # Laitlyngkot Ridge & Smit Bypass
    ("Smit_Connector", 91.90, 25.50, 91.96, 25.56),
    ("Laitlyngkot_Ridge", 91.80, 25.40, 91.88, 25.48),
    ("Laitlyngkot_Pynursla_Pass", 91.84, 25.32, 91.92, 25.40),
    # Pynursla, Pongtung & Dawki Border Gateway
    ("Pynursla_Pass", 91.88, 25.26, 91.95, 25.33),
    ("Pongtung_Descent", 91.92, 25.22, 91.98, 25.27),
    ("Dawki_Umngot_Border", 91.98, 25.16, 92.05, 25.22),
    ("Sohra_Pynursla_CrossLink", 91.75, 25.26, 91.88, 25.32),
]

DRIVABLE_HIGHWAYS = {
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "track",
}

EXCLUDED_HIGHWAYS = {
    "footway",
    "pedestrian",
    "steps",
    "path",
    "cycleway",
    "corridor",
    "bridleway",
    "proposed",
    "construction",
    "elevator",
}

# Regional elevation lookups for slope estimation
ELEVATION_ESTIMATES = {
    "shillong": 1520.0,
    "upper shillong": 1650.0,
    "mylliem": 1700.0,
    "mawphlang": 1820.0,
    "weiloi": 1400.0,
    "mawsynram": 1400.0,
    "cherrapunji": 1430.0,
    "sohra": 1430.0,
    "laitlyngkot": 1750.0,
    "smit": 1600.0,
    "pynursla": 1450.0,
    "pongtung": 900.0,
    "dawki": 120.0,
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates geodesic distance in meters between two coordinates."""
    r = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return r * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def polyline_length_m(coords: List[List[float]]) -> float:
    """Computes total polyline length in meters along [lng, lat] vertices."""
    total = 0.0
    for i in range(len(coords) - 1):
        total += haversine_m(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
    return total


def estimate_elevation(lat: float, lng: float) -> float:
    """Estimates elevation in meters based on proximity to known pilot elevations."""
    # Dawki is low valley (~120m) at lat < 25.20, lng > 91.98
    if lat < 25.20 and lng > 91.95:
        return 120.0 + (lat - 25.16) * 5000.0
    # Pongtung descent (900m)
    if lat < 25.25 and lng > 91.92:
        return 900.0
    # Cherrapunji / Sohra plateau (~1430m)
    if lat < 25.32 and lng < 91.75:
        return 1430.0
    # Mawphlang / Laitlyngkot high ridges (~1750m - 1820m)
    if lat > 25.40 and lat < 25.50:
        return 1750.0
    # Shillong basin (~1500m)
    return 1520.0


def download_osm_tile(name: str, minlon: float, minlat: float, maxlon: float, maxlat: float, raw_dir: str) -> str:
    """Downloads or retrieves cached OSM tile XML."""
    out_path = os.path.join(raw_dir, f"osm_{name}_{minlon:.2f}_{minlat:.2f}.xml")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
        print(f"  [Cache hit] {name} ({os.path.getsize(out_path) // 1024} KB)")
        return out_path

    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={minlon:.4f},{minlat:.4f},{maxlon:.4f},{maxlat:.4f}"
    print(f"  [Fetching OSM] {name} from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "RoadSafeAI-Meghalaya-Ingest/1.0"})

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            with open(out_path, "wb") as f:
                f.write(data)
            print(f"  ✓ Saved {name} ({len(data) // 1024} KB)")
            time.sleep(1.0)  # Respectful rate limiting
            return out_path
    except Exception as e:
        print(f"  ⚠️ Error downloading tile {name}: {e}")
        return ""


def main():
    print("=== RoadSafe AI: Real OpenStreetMap Network Ingestion Pipeline ===")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, ".."))
    data_dir = os.path.join(project_root, "data")
    raw_dir = os.path.join(data_dir, "raw")
    os.makedirs(raw_dir, exist_ok=True)

    # 1. Download or load all pilot bounding boxes
    print(f"\n1. Scanning/caching all pilot tiles in {raw_dir}...")
    import glob
    tile_files = sorted(glob.glob(os.path.join(raw_dir, "osm_*.xml")))
    print(f"  Found {len(tile_files)} cached OSM XML tiles.")

    print(f"\n2. Parsing OpenStreetMap XML & stitching road network...")
    raw_nodes: Dict[str, Tuple[float, float]] = {}  # node_id -> (lat, lng)
    raw_ways: List[Dict[str, Any]] = []

    # First pass: collect ALL nodes across all tiles
    for tf in tile_files:
        try:
            tree = ET.parse(tf)
            root = tree.getroot()
            for n in root.findall("node"):
                nid = n.attrib["id"]
                lat = float(n.attrib["lat"])
                lng = float(n.attrib["lon"])
                raw_nodes[nid] = (lat, lng)
        except Exception as e:
            print(f"  ⚠️ Failed parsing nodes from {tf}: {e}")

    # Second pass: collect ways with full node coordinates
    for tf in tile_files:
        try:
            tree = ET.parse(tf)
            root = tree.getroot()
            for w in root.findall("way"):
                wid = w.attrib["id"]
                tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
                hw = tags.get("highway")
                if not hw or hw in EXCLUDED_HIGHWAYS or hw not in DRIVABLE_HIGHWAYS:
                    continue
                if tags.get("access") in ["private", "no"]:
                    continue

                nd_refs = [nd.attrib["ref"] for nd in w.findall("nd")]
                if len(nd_refs) < 2:
                    continue

                raw_ways.append({
                    "osm_way_id": wid,
                    "nd_refs": nd_refs,
                    "tags": tags,
                })
        except Exception as e:
            print(f"  ⚠️ Failed parsing ways from {tf}: {e}")

    print(f"  ✓ Total unique OSM nodes gathered: {len(raw_nodes)}")
    print(f"  ✓ Total drivable OSM ways gathered: {len(raw_ways)}")

    # 3. Identify intersection junctions to split ways into topological edges
    node_usage_count: Dict[str, int] = {}
    for w in raw_ways:
        for nd in w["nd_refs"]:
            node_usage_count[nd] = node_usage_count.get(nd, 0) + 1

    # An intersection node is referenced by >= 2 ways, or is an endpoint of a way
    junction_nodes: Set[str] = set()
    for w in raw_ways:
        junction_nodes.add(w["nd_refs"][0])
        junction_nodes.add(w["nd_refs"][-1])
        for nd in w["nd_refs"]:
            if node_usage_count[nd] > 1:
                junction_nodes.add(nd)

    print(f"  ✓ Identified {len(junction_nodes)} topological junction nodes")

    # 4. Split ways at junctions to build real road segment edges with true curvature
    edges_out: List[Dict[str, Any]] = []
    nodes_out: Dict[str, Dict[str, Any]] = {}
    edge_counter = 1

    for w in raw_ways:
        tags = w["tags"]
        wid = w["osm_way_id"]
        hw = tags.get("highway", "secondary")
        name = tags.get("name", "")
        ref = tags.get("ref", "")
        oneway = tags.get("oneway") in ["yes", "1", "true"]
        surface = tags.get("surface", "paved" if hw in ["trunk", "primary", "secondary"] else "unpaved")
        smoothness = tags.get("smoothness", "good")
        is_bridge = tags.get("bridge") in ["yes", "viaduct"]
        is_tunnel = tags.get("tunnel") in ["yes", "building_passage"]

        # Speed limit derivation
        speed_tag = tags.get("maxspeed")
        try:
            speed_kmh = float(speed_tag.replace("km/h", "").strip()) if speed_tag else None
        except Exception:
            speed_kmh = None

        if not speed_kmh:
            if hw in ["motorway", "trunk"]:
                speed_kmh = 60.0
            elif hw == "primary":
                speed_kmh = 50.0
            elif hw == "secondary":
                speed_kmh = 40.0
            elif hw == "tertiary":
                speed_kmh = 30.0
            elif hw == "residential":
                speed_kmh = 25.0
            else:
                speed_kmh = 20.0

        # Road width derivation
        width_tag = tags.get("width")
        lanes_tag = tags.get("lanes")
        try:
            road_width = float(width_tag) if width_tag else (float(lanes_tag) * 3.2 if lanes_tag else None)
        except Exception:
            road_width = None

        if not road_width:
            if hw in ["motorway", "trunk"]:
                road_width = 8.5
            elif hw == "primary":
                road_width = 7.5
            elif hw == "secondary":
                road_width = 6.0
            elif hw == "tertiary":
                road_width = 5.0
            elif hw == "residential":
                road_width = 4.5
            else:
                road_width = 3.5

        # Weight limit derivation (conservative documented default)
        weight_tag = tags.get("maxweight")
        try:
            max_weight = float(weight_tag) * 1000.0 if weight_tag else None
        except Exception:
            max_weight = None

        if not max_weight:
            if is_bridge:
                max_weight = 30000.0
            else:
                max_weight = 40000.0

        # Clearance height derivation
        height_tag = tags.get("maxheight")
        try:
            max_height = float(height_tag) if height_tag else (3.8 if is_tunnel else 4.8)
        except Exception:
            max_height = 4.8

        # Display name fallback
        if not name:
            if ref:
                name = f"{ref} ({hw.replace('_', ' ').capitalize()})"
            else:
                name = f"Road {wid} ({hw.replace('_', ' ').capitalize()})"

        # Surface damage prior
        if surface in ["asphalt", "paved", "concrete"] and smoothness in ["good", "excellent"]:
            surface_damage = 0.08
        elif surface in ["unpaved", "compacted", "gravel"]:
            surface_damage = 0.35
        elif surface in ["dirt", "ground", "mud"] or smoothness in ["bad", "very_bad"]:
            surface_damage = 0.65
        else:
            surface_damage = 0.15

        # Split way by junction nodes
        curr_segment_nodes = [w["nd_refs"][0]]
        for nd in w["nd_refs"][1:]:
            curr_segment_nodes.append(nd)
            if nd in junction_nodes:
                # Valid junction-to-junction segment
                u = curr_segment_nodes[0]
                v = curr_segment_nodes[-1]

                if u != v and u in raw_nodes and v in raw_nodes:
                    coords = []
                    valid = True
                    for n_ref in curr_segment_nodes:
                        if n_ref in raw_nodes:
                            lat, lng = raw_nodes[n_ref]
                            coords.append([round(lng, 6), round(lat, 6)])
                        else:
                            valid = False
                            break

                    if valid and len(coords) >= 2:
                        length_m = polyline_length_m(coords)
                        if length_m >= 0.1:  # Keep all valid road links (only ignore zero-length points)
                            dist_km = round(max(0.001, length_m / 1000.0), 4)
                            travel_time_min = round((dist_km / speed_kmh) * 60.0, 3)

                            # Gradient / slope estimation
                            elev_u = estimate_elevation(raw_nodes[u][0], raw_nodes[u][1])
                            elev_v = estimate_elevation(raw_nodes[v][0], raw_nodes[v][1])
                            elev_diff = abs(elev_v - elev_u)
                            slope_deg = math.atan2(elev_diff, max(length_m, 10.0)) * 180.0 / math.pi
                            slope_norm = round(min(1.0, slope_deg / 20.0), 3)

                            # Landslide hazard prior based on slope and terrain
                            landslide_prior = round(min(0.85, slope_norm * 0.70 + 0.10), 3)
                            rainfall_norm = 0.40  # Default regional baseline

                            eid = f"OSM-E{edge_counter}"
                            edge_counter += 1

                            edge_obj = {
                                "id": eid,
                                "osm_way_id": wid,
                                "from": str(u),
                                "to": str(v),
                                "name": name,
                                "ref": ref,
                                "road_class": hw,
                                "distance_km": dist_km,
                                "length_m": round(length_m, 1),
                                "travel_time_min": travel_time_min,
                                "speed_limit_kmh": speed_kmh,
                                "width_m": road_width,
                                "max_weight_kg": max_weight,
                                "max_clearance_m": max_height,
                                "is_bridge": is_bridge,
                                "is_tunnel": is_tunnel,
                                "surface": surface,
                                "smoothness": smoothness,
                                "surface_damage": surface_damage,
                                "slope_norm": slope_norm,
                                "landslide_risk": landslide_prior,
                                "rainfall_norm": rainfall_norm,
                                "waterlogging_norm": 0.05,
                                "narrowness_norm": round(max(0.0, min(1.0, (7.0 - road_width) / 5.0)), 3),
                                "oneway": oneway,
                                "status": "open",
                                "coordinates": coords,
                            }
                            edges_out.append(edge_obj)

                            # Add reverse edge if two-way
                            if not oneway:
                                rev_edge = dict(edge_obj)
                                rev_edge["id"] = f"{eid}_rev"
                                rev_edge["from"] = str(v)
                                rev_edge["to"] = str(u)
                                rev_edge["coordinates"] = list(reversed(coords))
                                edges_out.append(rev_edge)

                            # Record endpoints
                            if u not in nodes_out:
                                lat_u, lng_u = raw_nodes[u]
                                nodes_out[u] = {
                                    "id": str(u),
                                    "name": f"Junction {u}",
                                    "lat": round(lat_u, 6),
                                    "lng": round(lng_u, 6),
                                    "elevation_m": round(elev_u, 1),
                                    "is_hub": False,
                                }
                            if v not in nodes_out:
                                lat_v, lng_v = raw_nodes[v]
                                nodes_out[v] = {
                                    "id": str(v),
                                    "name": f"Junction {v}",
                                    "lat": round(lat_v, 6),
                                    "lng": round(lng_v, 6),
                                    "elevation_m": round(elev_v, 1),
                                    "is_hub": False,
                                }

                curr_segment_nodes = [nd]

    # Tag prominent pilot hubs
    hub_locations = [
        ("Shillong City Center (Police Bazar)", 25.5788, 91.8933),
        ("Upper Shillong Depot", 25.5450, 91.8600),
        ("Mylliem Junction", 25.5140, 91.8540),
        ("Mawphlang Heritage Post", 25.4450, 91.7580),
        ("Weiloi Gorge Crossing", 25.3520, 91.6850),
        ("Cherrapunji (Sohra) Base", 25.2815, 91.7166),
        ("Mawsynram Station", 25.2970, 91.5820),
        ("Laitlyngkot Ridge Hub", 25.4370, 91.8340),
        ("Smit Eastern Hub", 25.5310, 91.9280),
        ("Pynursla Pass", 25.3050, 91.8940),
        ("Pongtung Village", 25.2500, 91.9500),
        ("Dawki Border Post", 25.1850, 92.0150),
    ]

    for hub_name, hlat, hlng in hub_locations:
        # Find closest junction node
        closest_id = None
        min_d = float("inf")
        for nid, nd in nodes_out.items():
            d = haversine_m(hlat, hlng, nd["lat"], nd["lng"])
            if d < min_d:
                min_d = d
                closest_id = nid
        if closest_id and min_d < 3000.0:  # Within 3 km
            nodes_out[closest_id]["name"] = hub_name
            nodes_out[closest_id]["is_hub"] = True

    final_nodes = list(nodes_out.values())
    total_km = sum(e["distance_km"] for e in edges_out if not e["id"].endswith("_rev"))

    out_file = os.path.join(data_dir, "meghalaya_osm_network.json")
    network_data = {
        "metadata": {
            "title": "RoadSafe AI Meghalaya East Khasi Hills Road Network",
            "source": "OpenStreetMap",
            "license": "Open Data Commons Open Database License (ODbL) 1.0",
            "attribution": "© OpenStreetMap contributors",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_nodes": len(final_nodes),
            "total_edges": len(edges_out),
            "total_drivable_km": round(total_km, 1),
            "bounding_box": [91.56, 25.16, 92.05, 25.62],
        },
        "nodes": final_nodes,
        "edges": edges_out,
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(network_data, f, indent=2)

    print(f"\n=======================================================")
    print(f"✓ REAL OSM ROAD NETWORK COMPILED & SAVED TO:")
    print(f"  {out_file}")
    print(f"  Nodes (True Junctions): {len(final_nodes):,}")
    print(f"  Edges (True Curvature Segments): {len(edges_out):,}")
    print(f"  Total Drivable Road Network: {total_km:,.1f} km")
    print(f"=======================================================\n")


if __name__ == "__main__":
    main()
