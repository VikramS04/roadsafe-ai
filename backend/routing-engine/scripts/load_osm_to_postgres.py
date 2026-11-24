import json
import psycopg2
from psycopg2.extras import execute_batch
import time

DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/roadsafe_ai"

def load_osm_into_postgres():
    print("Connecting to PostgreSQL...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    print("Ensuring PostGIS extension and columns...")
    cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    conn.commit()

    print("Reading OSM network JSON...")
    start_t = time.time()
    json_path = "backend/routing-engine/data/meghalaya_osm_network.json"
    if not os.path.exists(json_path) and os.path.exists(json_path + ".gz"):
        import gzip
        with gzip.open(json_path + ".gz", "rt", encoding="utf-8") as f:
            data = json.load(f)
    else:
        with open(json_path, "r") as f:
            data = json.load(f)
    print(f"Loaded JSON in {time.time() - start_t:.2f}s: {len(data['nodes'])} nodes, {len(data['edges'])} edges")

    # Clean existing nodes and segments
    print("Clearing old road nodes and segments...")
    cur.execute('DELETE FROM "RoadSegment";')
    cur.execute('DELETE FROM "RoadNode";')
    conn.commit()

    # Insert RoadNodes in batch
    print("Inserting RoadNodes...")
    node_tuples = [
        (
            n["id"],
            n.get("name", f"Junction {n['id']}"),
            float(n.get("lat", 0.0)),
            float(n.get("lng", 0.0)),
            float(n.get("elevation_m", 0.0)),
            bool(n.get("is_hub", False)),
            "East Khasi Hills"
        )
        for n in data["nodes"]
    ]
    node_sql = """
        INSERT INTO "RoadNode" ("id", "name", "lat", "lng", "elevationM", "isHub", "district")
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("id") DO NOTHING;
    """
    execute_batch(cur, node_sql, node_tuples, page_size=2000)
    conn.commit()
    print(f"Inserted {len(node_tuples)} RoadNodes.")

    # Prepare RoadSegments with PostGIS geometry
    print("Inserting RoadSegments...")
    edge_tuples = []
    for e in data["edges"]:
        coords_json = json.dumps(e.get("coordinates", []))
        edge_tuples.append((
            e["id"],
            str(e.get("osm_way_id", "")),
            e.get("name", e["id"]),
            e.get("ref", ""),
            str(e["from"]),
            str(e["to"]),
            float(e.get("distance_km", 0.0)),
            float(e.get("length_m", 0.0)),
            float(e.get("travel_time_min", 0.0)),
            float(e.get("speed_limit_kmh", 50.0)),
            e.get("road_class", "secondary"),
            float(e.get("width_m", 6.0)),
            float(e.get("max_weight_kg", 30000.0)),
            float(e.get("max_clearance_m", 4.2)),
            bool(e.get("is_bridge", False)),
            bool(e.get("is_tunnel", False)),
            e.get("surface", "paved"),
            e.get("smoothness", "good"),
            bool(e.get("oneway", False)),
            e.get("status", "open"),
            float(e.get("rainfall_norm", 0.0)),
            float(e.get("slope_norm", 0.0)),
            float(e.get("landslide_risk", 0.0)),
            float(e.get("surface_damage", 0.0)),
            float(e.get("waterlogging_norm", 0.0)),
            float(e.get("narrowness_norm", 0.0)),
            coords_json
        ))

    segment_sql = """
        INSERT INTO "RoadSegment" (
            "id", "osmWayId", "name", "ref", "fromNodeId", "toNodeId",
            "distanceKm", "lengthM", "baseTravelTimeMin", "speedLimitKmh",
            "roadClass", "widthM", "maxWeightKg", "maxClearanceM",
            "isBridge", "isTunnel", "surface", "smoothness", "oneway",
            "status", "rainfallNorm", "slopeNorm", "landslideRisk",
            "surfaceDamage", "waterloggingNorm", "narrownessNorm", "coordinatesJson"
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("id") DO NOTHING;
    """
    execute_batch(cur, segment_sql, edge_tuples, page_size=2000)
    conn.commit()
    print(f"Inserted {len(edge_tuples)} RoadSegments.")

    # Add PostGIS geometry column and update it from coordinatesJson
    print("Creating PostGIS geometry and spatial index...")
    cur.execute("""
        ALTER TABLE "RoadSegment" ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);
        UPDATE "RoadSegment"
        SET geom = ST_SetSRID(ST_GeomFromGeoJSON(
            json_build_object(
                'type', 'LineString',
                'coordinates', "coordinatesJson"::json
            )::text
        ), 4326)
        WHERE geom IS NULL AND "coordinatesJson" != '[]';
    """)
    conn.commit()

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_road_segment_geom ON "RoadSegment" USING GIST (geom);
    """)
    conn.commit()

    # Seed Vehicle Profiles if missing
    cur.execute('SELECT COUNT(*) FROM "VehicleProfile";')
    v_count = cur.fetchone()[0]
    if v_count == 0:
        print("Seeding Vehicle Profiles...")
        vehicles = [
            ("bike", "Motorcycle / Scooter", "bike", 350.0, 1.0, 1.2, 0.40, 1.5, 0.8, 1.2, 1.8, "Highly agile two-wheeler"),
            ("car", "Standard Passenger Car", "car", 2000.0, 2.0, 1.6, 0.50, 1.0, 1.0, 1.0, 1.0, "Standard four-wheeler"),
            ("suv", "SUV / 4x4 Jeep", "suv", 3200.0, 2.2, 2.0, 0.40, 0.8, 0.7, 0.8, 0.7, "High-clearance terrain vehicle"),
            ("truck", "Heavy Supply Truck", "truck", 35000.0, 2.8, 4.0, 0.60, 1.2, 1.5, 1.5, 1.2, "Heavy multi-axle freight carrier"),
            ("ambulance", "Emergency Ambulance", "ambulance", 3800.0, 2.3, 2.4, 0.45, 0.9, 0.9, 0.9, 0.8, "Emergency medical service responder")
        ]
        cur.executemany("""
            INSERT INTO "VehicleProfile" (
                "id", "name", "type", "maxWeightKg", "maxWidthM", "minClearanceM",
                "minSafetyScore", "sensitivityRainfall", "sensitivitySlope",
                "sensitivityLandslide", "sensitivitySurface", "description"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT ("id") DO NOTHING;
        """, vehicles)
        conn.commit()
        print("Seeded Vehicle Profiles.")

    # Seed realistic hazards on real OSM edges
    print("Finding representative edges for realistic hazard seeding...")
    # Find edges on NH6, Sohra, and Dawki
    cur.execute("""
        SELECT id, name, "distanceKm", "roadClass", "isBridge"
        FROM "RoadSegment"
        WHERE name ILIKE '%NH%' OR name ILIKE '%Sohra%' OR name ILIKE '%Cherrapunji%' OR "isBridge" = true
        LIMIT 20;
    """)
    sample_edges = cur.fetchall()
    print(f"Found {len(sample_edges)} sample edges for hazard snapping.")

    cur.close()
    conn.close()
    print("OSM network ingestion complete!")

if __name__ == "__main__":
    load_osm_into_postgres()
