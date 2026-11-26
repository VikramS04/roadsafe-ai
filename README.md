# RoadSafe AI — Safe Route Navigation for Everyday Travellers & Local Drivers

[![Status](https://img.shields.io/badge/Status-Operational-emerald)](#)
[![Stack](https://img.shields.io/badge/Stack-React%20%7C%20Node%20%7C%20FastAPI%20%7C%20PostgreSQL-blue)](#)
[![Version](https://img.shields.io/badge/Version-2.0.0-purple)](#)

RoadSafe AI is a Google Maps-like, map-first public web app for everyday travellers and local drivers navigating mountainous and disaster-prone terrains. It calculates the **safest feasible route for YOUR specific vehicle right now**, enriched with crowdsourced community hazard reporting and local verification.

Anyone can open RoadSafe AI, select their vehicle type, choose a destination, and receive the safest route in seconds — with no signups, no passwords, and no command-center complexity.

---

## 1. Core User Flows

1. **Search & Route**
   - Single unified search bar with place autocomplete (OpenStreetMap Nominatim + local network nodes) and "Use My Location" (GPS).
   - Vehicle Selection: **Bike** 🏍️, **Car** 🚗, **SUV / Jeep** 🚙, **Truck** 🚛, **Ambulance** 🚑 (remembered locally).
   - Objective Toggle: **Safest** 🛡️ (default) vs. **Fastest** ⚡.
   - Shows up to 3 routes on the map. The recommended route is the safest feasible path, each labelled with ETA, distance, and a safety rating band (**Green** / **Yellow** / **Red**).
   - Tapping a route reveals a plain-English "why" from the deterministic explainability module and highlights its weakest segment (bottleneck).
   - If no route is feasible, explains honestly which hazards block the alternatives — never presenting a Red route as safe.

2. **Report a Hazard (2 Taps)**
   - Floating "Report Hazard" button opens a quick picker:
     - **Landslide** 🪨
     - **Flooded Road** 🌊
     - **Fallen Tree** 🪵
     - **Damaged Road / Pothole** 🕳️
     - **Bridge Damaged** 🌉
     - **Road Blocked** ⛔
     - **Fog / Low Visibility** 🌫️
     - **Other Hazard** ⚠️
   - Automatically snaps report coordinates to the nearest road edge using PostGIS distance projection.
   - Optional note and photo URL.

3. **Confirm or Dispute (Crowdsourced Verification)**
   - Nearby users see an interactive card: *"Landslide reported 20 min ago. Still there?"* with **[👍 Still There (Yes)]**, **[👎 Not There (Dispute)]**, and **[🟢 Cleared]**.
   - A report becomes **CONFIRMED** after 3 distinct-device "Yes" votes.
   - A report becomes **CLEARED** after 3 "Cleared" votes.
   - **Unverified reports** apply only a mild routing penalty and never hard-close a road.
   - **Confirmed blocking reports** (landslide, road blocked, bridge damaged) dynamically prune the road edge for affected vehicles (e.g. heavy trucks and cars are detoured, while nimble bikes can maneuver through narrow clearings).
   - Reports expire after **6 hours** with continuous linear time-decay.

4. **Live Conditions Layer**
   - Toggle to overlay active hazards, weather/rainfall radar, and official disaster alerts (SDMA/IMD bulletins).
   - Live weather fetched from **Open-Meteo** (cached for 30 minutes, never blocks routing).

---

## 2. Anonymous Identity & Abuse Control

- **No Signups or Logins**: The client generates a random UUID `device_id` stored in `localStorage`.
- **Signed Device Tokens**: Generated via HMAC-SHA256 (`/api/v1/device/register`) and transmitted in the `Authorization: Bearer <token>` or `x-device-id` header.
- **Vote Integrity**: One vote per device per report (`UNIQUE(reportId, deviceId)`).
- **Proximity Gate**: Votes are rejected if the user is further than ~5 km from the hazard location.
- **Rate Limiting**: In-memory sliding window caps report creation to max 5 per device per 10 minutes.
- **Dynamic Reliability**: Device profiles maintain a reliability score (0.1 - 2.0) based on confirmed vs. disputed reports.

---

## 3. Architecture & Real OpenStreetMap Integration

```
                                  ┌──────────────────────────┐
                                  │   Public Web App (PWA)   │
                                  │   React 18 + Tailwind    │
                                  │   Leaflet / OSM Tiles    │
                                  └─────────────┬────────────┘
                                                │ REST API (/api/v1)
                                                ▼
                                  ┌──────────────────────────┐
                                  │  Node.js + Express API   │
                                  │  - Device Auth & Abuse   │
                                  │  - PostGIS Spatial Snap  │
                                  │  - Crowdsourced Hazards  │
                                  └──────┬─────────────┬─────┘
                     Prisma / SQL (5432) │             │ HTTP (8000)
                                         ▼             ▼
  ┌───────────────────────────────────────────┐   ┌──────────────────────────┐
  │         PostgreSQL 18 + PostGIS           │   │  Python Routing Engine   │
  │  - 51,611 Junction Nodes                  │   │  - NetworkX Dijkstra     │
  │  - 236,285 Road Segments (True Curvature) │   │  - Sigmoid Passability   │
  │  - GiST Spatial Indexing                  │   │  - Yen's K Alternatives  │
  └───────────────────────────────────────────┘   └──────────────────────────┘
```

---

## 4. Public API Specification (OpenAPI 3.0)

Interactive Swagger UI documentation is available at:
- `http://localhost:3000/api/docs` (Swagger UI)
- `http://localhost:3000/api-docs.json` (OpenAPI Spec)

### Core Endpoints
- `GET  /api/v1/geocode?q=place` — Search places via OSM Nominatim and local hubs
- `POST /api/v1/routes` — Compute safest vehicle routes with true road polylines & turn instructions
- `GET  /api/v1/hazards` — List active hazards within optional bounding box
- `POST /api/v1/hazards` — Submit community hazard report (auto-snapped to road edge)
- `POST /api/v1/hazards/:id/vote` — Cast yes/no/cleared verification vote (proximity-gated)
- `GET  /api/v1/conditions` — Live weather radar and official bulletins
- `GET  /api/v1/roads/geojson` — Primary road network GeoJSON with risk bands

---

## 5. Quickstart & Verification

### Prerequisites
- Node.js v18+ and npm
- Python 3.11+
- PostgreSQL 18+ with PostGIS running on port 5432 (`postgres:postgres@localhost:5432/roadsafe_ai`)

### 1. Database Setup & Seeding
```bash
cd backend/node-api
npm install
npx prisma db push
python3 ../routing-engine/scripts/load_osm_to_postgres.py
python3 scripts/seed_real_hazards.py
```

### 2. Start Python Routing Microservice (Port 8000)
```bash
cd backend/routing-engine
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3. Start Node.js API (Port 3000)
```bash
cd backend/node-api
npm run dev
```

### 4. Start Mobile-First Frontend (Port 5173)
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 6. Running Tests

```bash
# 1. Routing Engine Unit Tests (pytest)
cd backend/routing-engine
PYTHONPATH=. pytest tests/test_routing_engine.py

# 2. Node API & Admin Security / E2E Suites
cd backend/node-api
npm test

# 3. Frontend Navigation Engine & Component Tests + Production Build
cd frontend
npm test && npm run build
```

---

## 7. Admin Moderation Console (`/admin`)
See [docs/ADMIN.md](docs/ADMIN.md) for creating the first admin account via CLI (`scripts/create-admin.ts`), role permissions (`admin` vs `moderator`), httpOnly cookie + CSRF security, and audit logging.

---

## 8. OpenStreetMap Attribution
Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the Open Data Commons Open Database License (ODbL) 1.0. RoadSafe AI extracts, topologies, and displays real-world highway geometries for East Khasi Hills (Meghalaya, India) courtesy of OpenStreetMap contributors.
