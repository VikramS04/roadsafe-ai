import psycopg2
import json
from datetime import datetime, timedelta, timezone

DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/roadsafe_ai"

def seed_hazards():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Clear existing hazards and votes
    cur.execute('DELETE FROM "HazardVote";')
    cur.execute('DELETE FROM "HazardEvent";')
    cur.execute('DELETE FROM "HazardReport";')
    cur.execute('DELETE FROM "DeviceProfile";')
    conn.commit()

    # Seed device profiles
    devices = [
        ("dev-shillong-taxi-01", 1.4, 12, 45),
        ("dev-local-driver-01", 1.8, 8, 28),
        ("dev-sohra-resident-03", 1.6, 15, 60),
        ("dev-tourist-traveler-04", 0.9, 2, 5),
        ("dev-ambulance-paramedic", 2.0, 10, 30),
    ]
    for did, score, rep_c, vote_c in devices:
        cur.execute("""
            INSERT INTO "DeviceProfile" ("id", "deviceId", "reliabilityScore", "reportCount", "voteCount", "lastActiveAt", "createdAt")
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT ("deviceId") DO UPDATE SET "reliabilityScore" = EXCLUDED."reliabilityScore";
        """, (did, did, score, rep_c, vote_c))
    conn.commit()

    # Define hazards to snap to real road network
    hazard_specs = [
        {
            "id": "haz-01",
            "type": "landslide",
            "severity": "critical",
            "target_lat": 25.3250,
            "target_lng": 91.8920,
            "status": "confirmed",
            "confirm_count": 4,
            "clear_count": 0,
            "note": "Severe rockfall and landslide blocking both lanes near Pynursla pass on NH-06.",
            "photo_url": "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957",
            "device_id": "dev-local-driver-01",
            "minutes_ago": 45,
            "expires_in_hours": 6,
        },
        {
            "id": "haz-02",
            "type": "flooded_road",
            "severity": "high",
            "target_lat": 25.1950,
            "target_lng": 92.0080,
            "status": "confirmed",
            "confirm_count": 3,
            "clear_count": 0,
            "note": "River Umngot approach road inundated with 40cm water after torrential rain. Impassable for regular cars.",
            "photo_url": "https://images.unsplash.com/photo-1517649763962-0c623266ddc0",
            "device_id": "dev-shillong-taxi-01",
            "minutes_ago": 70,
            "expires_in_hours": 4,
        },
        {
            "id": "haz-03",
            "type": "fallen_tree",
            "severity": "medium",
            "target_lat": 25.5180,
            "target_lng": 91.8540,
            "status": "unverified",
            "confirm_count": 1,
            "clear_count": 0,
            "note": "Large pine branch hanging low across southbound shoulder near Mylliem market.",
            "photo_url": None,
            "device_id": "dev-tourist-traveler-04",
            "minutes_ago": 15,
            "expires_in_hours": 6,
        },
        {
            "id": "haz-04",
            "type": "damaged_road",
            "severity": "medium",
            "target_lat": 25.4480,
            "target_lng": 91.7600,
            "status": "confirmed",
            "confirm_count": 3,
            "clear_count": 0,
            "note": "Cluster of deep rainwater potholes on Mawphlang Valley curve. Slow down to under 20 km/h.",
            "photo_url": None,
            "device_id": "dev-sohra-resident-03",
            "minutes_ago": 120,
            "expires_in_hours": 4,
        },
        {
            "id": "haz-05",
            "type": "fog_visibility",
            "severity": "low",
            "target_lat": 25.4370,
            "target_lng": 91.8340,
            "status": "unverified",
            "confirm_count": 2,
            "clear_count": 0,
            "note": "Heavy mountain fog on Laitlyngkot ridge. Visibility down to 25 meters.",
            "photo_url": None,
            "device_id": "dev-shillong-taxi-01",
            "minutes_ago": 30,
            "expires_in_hours": 3,
        },
        {
            "id": "haz-06",
            "type": "bridge_damaged",
            "severity": "high",
            "target_lat": 25.3520,
            "target_lng": 91.7700,
            "status": "confirmed",
            "confirm_count": 5,
            "clear_count": 0,
            "note": "Culvert abutment cracked near Sohra direct road. Closed to trucks and loaded commercial vehicles.",
            "photo_url": None,
            "device_id": "dev-local-driver-01",
            "minutes_ago": 180,
            "expires_in_hours": 6,
        },
        {
            "id": "haz-07",
            "type": "landslide",
            "severity": "high",
            "target_lat": 25.3620,
            "target_lng": 91.7300,
            "status": "confirmed",
            "confirm_count": 4,
            "clear_count": 0,
            "note": "Active mudflow and loose gravel sliding down steep cliff section of scenic detour route.",
            "photo_url": None,
            "device_id": "dev-sohra-resident-03",
            "minutes_ago": 90,
            "expires_in_hours": 5,
        },
        {
            "id": "haz-08",
            "type": "road_blocked",
            "severity": "low",
            "target_lat": 25.5350,
            "target_lng": 91.9180,
            "status": "unverified",
            "confirm_count": 1,
            "clear_count": 0,
            "note": "Broken down timber transport tractor causing slow moving traffic on Smit link.",
            "photo_url": None,
            "device_id": "dev-tourist-traveler-04",
            "minutes_ago": 20,
            "expires_in_hours": 3,
        },
    ]

    now = datetime.now(timezone.utc)
    for h in hazard_specs:
        # Snap to nearest road segment in PostGIS
        cur.execute("""
            SELECT id, name, "roadClass",
                   ST_X(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))) AS snap_lng,
                   ST_Y(ST_ClosestPoint(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326))) AS snap_lat,
                   round(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography)) AS dist_m
            FROM "RoadSegment"
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326)
            LIMIT 1;
        """, (h["target_lng"], h["target_lat"], h["target_lng"], h["target_lat"], h["target_lng"], h["target_lat"], h["target_lng"], h["target_lat"]))
        row = cur.fetchone()
        if not row:
            continue
        edge_id, road_name, rclass, snap_lng, snap_lat, dist_m = row
        print(f"Hazard {h['id']} ({h['type']}) snapped to {edge_id} ('{road_name}') at {dist_m}m")

        rep_at = now - timedelta(minutes=h["minutes_ago"])
        exp_at = now + timedelta(hours=h["expires_in_hours"])

        cur.execute("""
            INSERT INTO "HazardReport" (
                "id", "type", "severity", "edgeId", "lat", "lng",
                "status", "confirmCount", "clearCount", "note", "photoUrl",
                "deviceId", "reportedAt", "expiresAt", "updatedAt"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT ("id") DO UPDATE SET
                "edgeId" = EXCLUDED."edgeId",
                "lat" = EXCLUDED."lat",
                "lng" = EXCLUDED."lng",
                "status" = EXCLUDED."status";
        """, (
            h["id"], h["type"], h["severity"], edge_id, snap_lat, snap_lng,
            h["status"], h["confirm_count"], h["clear_count"], h["note"], h["photo_url"],
            h["device_id"], rep_at, exp_at, now
        ))

        # Insert confirmation votes
        if h["status"] == "confirmed":
            voters = ["dev-local-driver-01", "dev-sohra-resident-03", "dev-shillong-taxi-01"][:h["confirm_count"]]
            for vid in voters:
                cur.execute("""
                    INSERT INTO "HazardVote" ("id", "reportId", "deviceId", "vote", "lat", "lng", "createdAt")
                    VALUES (gen_random_uuid(), %s, %s, 'yes', %s, %s, %s)
                    ON CONFLICT ("reportId", "deviceId") DO NOTHING;
                """, (h["id"], vid, snap_lat, snap_lng, rep_at + timedelta(minutes=5)))

    conn.commit()
    cur.close()
    conn.close()
    print("✓ Successfully seeded realistic hazards snapped to real OSM edges!")

if __name__ == "__main__":
    seed_hazards()
