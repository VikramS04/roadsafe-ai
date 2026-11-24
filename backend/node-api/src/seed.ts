import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting RoadSafe AI (Public/Local Drivers) Database Seeding ---');

  // 1. Seed Vehicle Profiles (Bike, Car, SUV/Jeep, Truck, Ambulance)
  const vehicles = [
    {
      id: 'bike',
      name: 'Motorcycle / Scooter',
      type: 'bike',
      maxWeightKg: 250,
      maxWidthM: 0.9,
      minClearanceM: 0.20,
      minSafetyScore: 0.35,
      sensitivityRainfall: 1.4,
      sensitivitySlope: 0.7,
      sensitivityLandslide: 1.2, // Bikes can often squeeze past narrow shoulder blockages
      sensitivitySurface: 1.6,
      description: 'Nimble two-wheeler; can navigate narrow lanes and bypass minor debris.',
    },
    {
      id: 'car',
      name: 'Sedan / Hatchback',
      type: 'car',
      maxWeightKg: 1800,
      maxWidthM: 1.8,
      minClearanceM: 0.25,
      minSafetyScore: 0.50,
      sensitivityRainfall: 1.0,
      sensitivitySlope: 1.0,
      sensitivityLandslide: 1.8,
      sensitivitySurface: 1.2,
      description: 'Standard consumer car; requires paved road and moderate clearance.',
    },
    {
      id: 'suv',
      name: '4x4 SUV / Jeep',
      type: 'suv',
      maxWeightKg: 2800,
      maxWidthM: 2.0,
      minClearanceM: 0.40,
      minSafetyScore: 0.45,
      sensitivityRainfall: 0.8,
      sensitivitySlope: 0.8,
      sensitivityLandslide: 1.4,
      sensitivitySurface: 0.6,
      description: 'High-clearance all-wheel drive; handles rough terrain, water splashes, and steep grades.',
    },
    {
      id: 'truck',
      name: 'Heavy Supply Truck',
      type: 'truck',
      maxWeightKg: 16000,
      maxWidthM: 2.6,
      minClearanceM: 1.10,
      minSafetyScore: 0.60,
      sensitivityRainfall: 1.2,
      sensitivitySlope: 1.6,
      sensitivityLandslide: 2.5, // Landslides or soft shoulders are fatal for heavy trucks
      sensitivitySurface: 1.4,
      description: 'Heavy transport; strictly bound by bridge load limits and road width.',
    },
    {
      id: 'ambulance',
      name: 'Emergency Ambulance',
      type: 'ambulance',
      maxWeightKg: 3800,
      maxWidthM: 2.1,
      minClearanceM: 0.35,
      minSafetyScore: 0.55,
      sensitivityRainfall: 1.1,
      sensitivitySlope: 1.1,
      sensitivityLandslide: 2.0,
      sensitivitySurface: 1.5,
      description: 'Emergency vehicle prioritising fast yet reliably passable corridors.',
    },
  ];

  for (const v of vehicles) {
    await prisma.vehicleProfile.upsert({
      where: { id: v.id },
      update: v,
      create: v,
    });
  }
  console.log(`✓ Seeded ${vehicles.length} vehicle profiles`);

  // 2. Seed Road Nodes (East Khasi Hills corridor)
  const nodes = [
    { id: 'N1', name: 'Shillong City Center', lat: 25.5788, lng: 91.8933, elevationM: 1520, isHub: true, district: 'East Khasi Hills' },
    { id: 'N2', name: 'Upper Shillong', lat: 25.5450, lng: 91.8600, elevationM: 1650, isHub: true, district: 'East Khasi Hills' },
    { id: 'N3', name: 'Mylliem Junction', lat: 25.5140, lng: 91.8540, elevationM: 1700, isHub: false, district: 'East Khasi Hills' },
    { id: 'N4', name: 'Mawphlang Sacred Grove', lat: 25.4450, lng: 91.7580, elevationM: 1820, isHub: false, district: 'East Khasi Hills' },
    { id: 'N5', name: 'Weiloi Gorge', lat: 25.3520, lng: 91.6850, elevationM: 1400, isHub: false, district: 'East Khasi Hills' },
    { id: 'N6', name: 'Mawsynram Village', lat: 25.2970, lng: 91.5820, elevationM: 1400, isHub: false, district: 'East Khasi Hills' },
    { id: 'N7', name: 'Cherrapunji (Sohra)', lat: 25.2815, lng: 91.7166, elevationM: 1430, isHub: true, district: 'East Khasi Hills' },
    { id: 'N8', name: 'Laitlyngkot Ridge', lat: 25.4370, lng: 91.8340, elevationM: 1750, isHub: false, district: 'East Khasi Hills' },
    { id: 'N9', name: 'Smit Village', lat: 25.5310, lng: 91.9280, elevationM: 1600, isHub: true, district: 'East Khasi Hills' },
    { id: 'N10', name: 'Pynursla Town', lat: 25.3050, lng: 91.8940, elevationM: 1450, isHub: false, district: 'East Khasi Hills' },
    { id: 'N11', name: 'Pongtung Bazaar', lat: 25.2500, lng: 91.9500, elevationM: 900, isHub: false, district: 'East Khasi Hills' },
    { id: 'N12', name: 'Dawki Border Town', lat: 25.1850, lng: 92.0150, elevationM: 120, isHub: true, district: 'West Jaintia Hills' },
  ];

  for (const n of nodes) {
    await prisma.roadNode.upsert({
      where: { id: n.id },
      update: n,
      create: n,
    });
  }
  console.log(`✓ Seeded ${nodes.length} road network nodes`);

  const nodeCoords = Object.fromEntries(nodes.map(n => [n.id, [n.lng, n.lat]]));

  // 3. Seed Road Segments
  const edges = [
    { id: 'E1', name: 'NH-06 Shillong Main Arterial', fromNodeId: 'N1', toNodeId: 'N2', distanceKm: 8.0, baseTravelTimeMin: 18.0, roadClass: 'highway', widthM: 8.0, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.15, slopeNorm: 0.20, landslideRisk: 0.05, surfaceDamage: 0.10, narrownessNorm: 0.10 },
    { id: 'E2', name: 'NH-06 Mylliem Approach', fromNodeId: 'N2', toNodeId: 'N3', distanceKm: 7.5, baseTravelTimeMin: 15.0, roadClass: 'highway', widthM: 7.5, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.25, slopeNorm: 0.35, landslideRisk: 0.12, surfaceDamage: 0.15, narrownessNorm: 0.15 },
    { id: 'E3', name: 'SH-5 Mawphlang Valley Corridor', fromNodeId: 'N3', toNodeId: 'N4', distanceKm: 14.0, baseTravelTimeMin: 28.0, roadClass: 'secondary', widthM: 6.0, maxWeightKg: 25000.0, maxClearanceM: 4.2, isBridge: false, status: 'open', rainfallNorm: 0.45, slopeNorm: 0.50, landslideRisk: 0.30, surfaceDamage: 0.25, narrownessNorm: 0.35 },
    { id: 'E4', name: 'SH-5 Weiloi Link', fromNodeId: 'N4', toNodeId: 'N5', distanceKm: 15.0, baseTravelTimeMin: 32.0, roadClass: 'secondary', widthM: 5.5, maxWeightKg: 20000.0, maxClearanceM: 4.0, isBridge: false, status: 'open', rainfallNorm: 0.55, slopeNorm: 0.65, landslideRisk: 0.40, surfaceDamage: 0.35, narrownessNorm: 0.45 },
    { id: 'E5', name: 'Mawsynram Heavy Rain Route', fromNodeId: 'N5', toNodeId: 'N6', distanceKm: 18.0, baseTravelTimeMin: 45.0, roadClass: 'rural', widthM: 4.5, maxWeightKg: 12000.0, maxClearanceM: 3.6, isBridge: false, status: 'open', rainfallNorm: 0.90, slopeNorm: 0.70, landslideRisk: 0.65, surfaceDamage: 0.50, narrownessNorm: 0.60 },
    { id: 'E6', name: 'Sohra West Mountain Route', fromNodeId: 'N5', toNodeId: 'N7', distanceKm: 20.0, baseTravelTimeMin: 48.0, roadClass: 'secondary', widthM: 5.5, maxWeightKg: 20000.0, maxClearanceM: 4.0, isBridge: false, status: 'open', rainfallNorm: 0.70, slopeNorm: 0.75, landslideRisk: 0.50, surfaceDamage: 0.40, narrownessNorm: 0.45 },
    { id: 'E7', name: 'NH-06 Laitlyngkot Ridge Highway', fromNodeId: 'N3', toNodeId: 'N8', distanceKm: 13.0, baseTravelTimeMin: 24.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.30, slopeNorm: 0.40, landslideRisk: 0.15, surfaceDamage: 0.10, narrownessNorm: 0.20 },
    { id: 'E8', name: 'NH-06 Pynursla High Landslide Pass', fromNodeId: 'N8', toNodeId: 'N10', distanceKm: 19.0, baseTravelTimeMin: 42.0, roadClass: 'highway', widthM: 6.5, maxWeightKg: 30000.0, maxClearanceM: 4.2, isBridge: false, status: 'caution', rainfallNorm: 0.75, slopeNorm: 0.80, landslideRisk: 0.70, surfaceDamage: 0.60, narrownessNorm: 0.30 },
    { id: 'E9', name: 'NH-06 Pongtung Descent', fromNodeId: 'N10', toNodeId: 'N11', distanceKm: 12.0, baseTravelTimeMin: 22.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.35, slopeNorm: 0.50, landslideRisk: 0.20, surfaceDamage: 0.20, narrownessNorm: 0.20 },
    { id: 'E10', name: 'Dawki Valley Gateway', fromNodeId: 'N11', toNodeId: 'N12', distanceKm: 14.0, baseTravelTimeMin: 28.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.20, slopeNorm: 0.30, landslideRisk: 0.10, surfaceDamage: 0.15, narrownessNorm: 0.20 },
    { id: 'E11', name: 'Smit Eastern Connector', fromNodeId: 'N1', toNodeId: 'N9', distanceKm: 16.0, baseTravelTimeMin: 32.0, roadClass: 'secondary', widthM: 6.0, maxWeightKg: 25000.0, maxClearanceM: 4.2, isBridge: false, status: 'open', rainfallNorm: 0.20, slopeNorm: 0.30, landslideRisk: 0.10, surfaceDamage: 0.15, narrownessNorm: 0.30 },
    { id: 'E12', name: 'Smit-Laitlyngkot Relief Cutoff', fromNodeId: 'N9', toNodeId: 'N8', distanceKm: 15.0, baseTravelTimeMin: 36.0, roadClass: 'secondary', widthM: 5.5, maxWeightKg: 18000.0, maxClearanceM: 4.0, isBridge: false, status: 'open', rainfallNorm: 0.35, slopeNorm: 0.45, landslideRisk: 0.25, surfaceDamage: 0.25, narrownessNorm: 0.40 },
    { id: 'E13', name: 'Cherrapunji Scenic Detour (Steep)', fromNodeId: 'N4', toNodeId: 'N7', distanceKm: 25.0, baseTravelTimeMin: 60.0, roadClass: 'rural', widthM: 4.0, maxWeightKg: 8000.0, maxClearanceM: 3.4, isBridge: false, status: 'open', rainfallNorm: 0.80, slopeNorm: 0.85, landslideRisk: 0.65, surfaceDamage: 0.45, narrownessNorm: 0.70 },
    { id: 'E14', name: 'Upper Shillong Bypass Expressway', fromNodeId: 'N2', toNodeId: 'N8', distanceKm: 18.0, baseTravelTimeMin: 32.0, roadClass: 'highway', widthM: 8.0, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.20, slopeNorm: 0.25, landslideRisk: 0.08, surfaceDamage: 0.10, narrownessNorm: 0.10 },
    { id: 'E15', name: 'Laitlyngkot-Sohra Direct Shortcut', fromNodeId: 'N8', toNodeId: 'N7', distanceKm: 24.0, baseTravelTimeMin: 52.0, roadClass: 'secondary', widthM: 5.5, maxWeightKg: 16000.0, maxClearanceM: 3.8, isBridge: false, status: 'open', rainfallNorm: 0.60, slopeNorm: 0.60, landslideRisk: 0.45, surfaceDamage: 0.30, narrownessNorm: 0.40 },
    { id: 'E16', name: 'Umngot River Suspension Bridge', fromNodeId: 'N10', toNodeId: 'N12', distanceKm: 28.0, baseTravelTimeMin: 55.0, roadClass: 'highway', widthM: 5.0, maxWeightKg: 10000.0, maxClearanceM: 3.8, isBridge: true, status: 'open', rainfallNorm: 0.40, slopeNorm: 0.30, landslideRisk: 0.20, surfaceDamage: 0.15, narrownessNorm: 0.50 },
    { id: 'E17', name: 'Sohra to Pynursla Cross-Link', fromNodeId: 'N7', toNodeId: 'N10', distanceKm: 22.0, baseTravelTimeMin: 45.0, roadClass: 'secondary', widthM: 5.5, maxWeightKg: 20000.0, maxClearanceM: 4.0, isBridge: false, status: 'open', rainfallNorm: 0.50, slopeNorm: 0.55, landslideRisk: 0.35, surfaceDamage: 0.25, narrownessNorm: 0.40 },
    // Reverse edges
    { id: 'E1_rev', name: 'NH-06 Shillong Main (Northbound)', fromNodeId: 'N2', toNodeId: 'N1', distanceKm: 8.0, baseTravelTimeMin: 18.0, roadClass: 'highway', widthM: 8.0, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.15, slopeNorm: 0.20, landslideRisk: 0.05, surfaceDamage: 0.10, narrownessNorm: 0.10 },
    { id: 'E2_rev', name: 'NH-06 Mylliem (Northbound)', fromNodeId: 'N3', toNodeId: 'N2', distanceKm: 7.5, baseTravelTimeMin: 15.0, roadClass: 'highway', widthM: 7.5, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.25, slopeNorm: 0.35, landslideRisk: 0.12, surfaceDamage: 0.15, narrownessNorm: 0.15 },
    { id: 'E7_rev', name: 'NH-06 Laitlyngkot (Northbound)', fromNodeId: 'N8', toNodeId: 'N3', distanceKm: 13.0, baseTravelTimeMin: 24.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.30, slopeNorm: 0.40, landslideRisk: 0.15, surfaceDamage: 0.10, narrownessNorm: 0.20 },
    { id: 'E8_rev', name: 'NH-06 Pynursla Pass (Northbound)', fromNodeId: 'N10', toNodeId: 'N8', distanceKm: 19.0, baseTravelTimeMin: 42.0, roadClass: 'highway', widthM: 6.5, maxWeightKg: 30000.0, maxClearanceM: 4.2, isBridge: false, status: 'caution', rainfallNorm: 0.75, slopeNorm: 0.80, landslideRisk: 0.70, surfaceDamage: 0.60, narrownessNorm: 0.30 },
    { id: 'E9_rev', name: 'NH-06 Pongtung (Ascent)', fromNodeId: 'N11', toNodeId: 'N10', distanceKm: 12.0, baseTravelTimeMin: 26.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.35, slopeNorm: 0.50, landslideRisk: 0.20, surfaceDamage: 0.20, narrownessNorm: 0.20 },
    { id: 'E10_rev', name: 'Dawki Gateway (Northbound)', fromNodeId: 'N12', toNodeId: 'N11', distanceKm: 14.0, baseTravelTimeMin: 32.0, roadClass: 'highway', widthM: 7.0, maxWeightKg: 35000.0, maxClearanceM: 4.5, isBridge: false, status: 'open', rainfallNorm: 0.20, slopeNorm: 0.30, landslideRisk: 0.10, surfaceDamage: 0.15, narrownessNorm: 0.20 },
    { id: 'E14_rev', name: 'Upper Shillong Bypass (Northbound)', fromNodeId: 'N8', toNodeId: 'N2', distanceKm: 18.0, baseTravelTimeMin: 32.0, roadClass: 'highway', widthM: 8.0, maxWeightKg: 40000.0, maxClearanceM: 4.8, isBridge: false, status: 'open', rainfallNorm: 0.20, slopeNorm: 0.25, landslideRisk: 0.08, surfaceDamage: 0.10, narrownessNorm: 0.10 },
  ];

  for (const e of edges) {
    const coords = [nodeCoords[e.fromNodeId], nodeCoords[e.toNodeId]];
    await prisma.roadSegment.upsert({
      where: { id: e.id },
      update: { ...e, coordinatesJson: JSON.stringify(coords) },
      create: { ...e, coordinatesJson: JSON.stringify(coords) },
    });
  }
  console.log(`✓ Seeded ${edges.length} road network segments`);

  // 4. Seed Seed-Devices for realistic community reporting
  const seedDevices = [
    { deviceId: 'dev-local-driver-01', reliabilityScore: 1.4 },
    { deviceId: 'dev-taxi-union-shillong', reliabilityScore: 1.5 },
    { deviceId: 'dev-sohra-resident-03', reliabilityScore: 1.2 },
    { deviceId: 'dev-tourist-traveler-04', reliabilityScore: 0.9 },
  ];
  for (const d of seedDevices) {
    await prisma.deviceProfile.upsert({
      where: { deviceId: d.deviceId },
      update: d,
      create: d,
    });
  }

  // 5. Seed ~10 Realistic Meghalaya Hazards
  const now = new Date();
  const inHours = (h: number) => new Date(now.getTime() + h * 3600 * 1000);
  const agoMinutes = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  const seededHazards = [
    {
      id: 'haz-01',
      type: 'landslide',
      severity: 'critical',
      edgeId: 'E8',
      lat: 25.3050,
      lng: 91.8940,
      status: 'confirmed',
      confirmCount: 4,
      clearCount: 0,
      note: 'Major debris and rockfall blocking both lanes across Pynursla Pass. Heavy trucks blocked; light vehicles attempting single-track detour with spotters.',
      photoUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957',
      deviceId: 'dev-taxi-union-shillong',
      reportedAt: agoMinutes(45),
      expiresAt: inHours(5),
    },
    {
      id: 'haz-02',
      type: 'flooded_road',
      severity: 'critical',
      edgeId: 'E16',
      lat: 25.1950,
      lng: 92.0050,
      status: 'confirmed',
      confirmCount: 3,
      clearCount: 0,
      note: 'River Umngot approach road inundated with 40cm water after overnight heavy rain. Impassable for regular cars.',
      photoUrl: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0',
      deviceId: 'dev-local-driver-01',
      reportedAt: agoMinutes(70),
      expiresAt: inHours(4),
    },
    {
      id: 'haz-03',
      type: 'fallen_tree',
      severity: 'medium',
      edgeId: 'E2',
      lat: 25.5250,
      lng: 91.8560,
      status: 'unverified',
      confirmCount: 1,
      clearCount: 0,
      note: 'Large pine branch hanging low across southbound shoulder near Mylliem market.',
      photoUrl: null,
      deviceId: 'dev-tourist-traveler-04',
      reportedAt: agoMinutes(15),
      expiresAt: inHours(6),
    },
    {
      id: 'haz-04',
      type: 'damaged_road',
      severity: 'medium',
      edgeId: 'E3',
      lat: 25.4600,
      lng: 91.7800,
      status: 'confirmed',
      confirmCount: 3,
      clearCount: 0,
      note: 'Cluster of deep rainwater potholes on Mawphlang Valley curve. Slow down to under 20 km/h.',
      photoUrl: null,
      deviceId: 'dev-sohra-resident-03',
      reportedAt: agoMinutes(120),
      expiresAt: inHours(4),
    },
    {
      id: 'haz-05',
      type: 'fog_visibility',
      severity: 'low',
      edgeId: 'E7',
      lat: 25.4370,
      lng: 91.8340,
      status: 'unverified',
      confirmCount: 2,
      clearCount: 0,
      note: 'Heavy mountain fog on Laitlyngkot ridge. Visibility down to 25 meters.',
      photoUrl: null,
      deviceId: 'dev-taxi-union-shillong',
      reportedAt: agoMinutes(30),
      expiresAt: inHours(3),
    },
    {
      id: 'haz-06',
      type: 'bridge_damaged',
      severity: 'high',
      edgeId: 'E15',
      lat: 25.3500,
      lng: 91.7700,
      status: 'confirmed',
      confirmCount: 5,
      clearCount: 0,
      note: 'Culvert abutment cracked near Sohra direct road. Closed to trucks and loaded commercial vehicles.',
      photoUrl: null,
      deviceId: 'dev-local-driver-01',
      reportedAt: agoMinutes(180),
      expiresAt: inHours(6),
    },
    {
      id: 'haz-07',
      type: 'landslide',
      severity: 'high',
      edgeId: 'E13',
      lat: 25.3600,
      lng: 91.7300,
      status: 'confirmed',
      confirmCount: 4,
      clearCount: 0,
      note: 'Active mudflow and loose gravel sliding down steep cliff section of scenic detour route.',
      photoUrl: null,
      deviceId: 'dev-sohra-resident-03',
      reportedAt: agoMinutes(90),
      expiresAt: inHours(5),
    },
    {
      id: 'haz-08',
      type: 'road_blocked',
      severity: 'low',
      edgeId: 'E11',
      lat: 25.5400,
      lng: 91.9100,
      status: 'unverified',
      confirmCount: 1,
      clearCount: 0,
      note: 'Broken down timber transport tractor causing slow moving traffic on Smit link.',
      photoUrl: null,
      deviceId: 'dev-tourist-traveler-04',
      reportedAt: agoMinutes(20),
      expiresAt: inHours(2),
    },
    {
      id: 'haz-09',
      type: 'flooded_road',
      severity: 'high',
      edgeId: 'E5',
      lat: 25.3200,
      lng: 91.6300,
      status: 'confirmed',
      confirmCount: 3,
      clearCount: 0,
      note: 'Flash water overflow across road dip leading to Mawsynram station.',
      photoUrl: null,
      deviceId: 'dev-local-driver-01',
      reportedAt: agoMinutes(60),
      expiresAt: inHours(5),
    },
    {
      id: 'haz-10',
      type: 'fallen_tree',
      severity: 'low',
      edgeId: 'E4',
      lat: 25.3900,
      lng: 91.7200,
      status: 'cleared',
      confirmCount: 1,
      clearCount: 3,
      note: 'Fallen tree cleared by local villagers and PWD patrol. Road is fully open now.',
      photoUrl: null,
      deviceId: 'dev-sohra-resident-03',
      reportedAt: agoMinutes(240),
      expiresAt: inHours(1),
    },
  ];

  for (const h of seededHazards) {
    await prisma.hazardReport.upsert({
      where: { id: h.id },
      update: h,
      create: h,
    });

    // Record initial event
    await prisma.hazardEvent.create({
      data: {
        eventType: h.status === 'confirmed' ? 'STATUS_CONFIRMED' : h.status === 'cleared' ? 'STATUS_CLEARED' : 'REPORT_CREATED',
        reportId: h.id,
        deviceId: h.deviceId,
        edgeId: h.edgeId,
        payloadJson: JSON.stringify({
          type: h.type,
          severity: h.severity,
          status: h.status,
          confirmCount: h.confirmCount,
          note: h.note,
        }),
      },
    });
  }
  console.log(`✓ Seeded ${seededHazards.length} realistic Meghalaya hazards`);

  console.log('--- Public Driver Database Seeding Completed Successfully ---');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
