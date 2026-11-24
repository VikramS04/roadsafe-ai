const fs = require('fs');

const SAMPLE_OD_PAIRS = [
  { name: 'Shillong (Police Bazar) -> Cherrapunji (Sohra)', o: { lat: 25.5788, lng: 91.8933 }, d: { lat: 25.2815, lng: 91.7166 }, vehicle: 'car' },
  { name: 'Shillong -> Mawphlang Sacred Grove', o: { lat: 25.5788, lng: 91.8933 }, d: { lat: 25.4450, lng: 91.7580 }, vehicle: 'car' },
  { name: 'Mawphlang -> Cherrapunji', o: { lat: 25.4450, lng: 91.7580 }, d: { lat: 25.2815, lng: 91.7166 }, vehicle: 'suv' },
  { name: 'Shillong -> Laitlyngkot Ridge', o: { lat: 25.5788, lng: 91.8933 }, d: { lat: 25.4370, lng: 91.8340 }, vehicle: 'car' },
  { name: 'Laitlyngkot -> Cherrapunji', o: { lat: 25.4370, lng: 91.8340 }, d: { lat: 25.2815, lng: 91.7166 }, vehicle: 'car' },
  { name: 'Upper Shillong -> Mawphlang', o: { lat: 25.5450, lng: 91.8600 }, d: { lat: 25.4450, lng: 91.7580 }, vehicle: 'bike' },
  { name: 'Shillong -> Weiloi Gorge', o: { lat: 25.5788, lng: 91.8933 }, d: { lat: 25.3520, lng: 91.6850 }, vehicle: 'suv' },
  { name: 'Mylliem -> Sohra', o: { lat: 25.5140, lng: 91.8540 }, d: { lat: 25.2815, lng: 91.7166 }, vehicle: 'car' },
  { name: 'Shillong -> Smit Village', o: { lat: 25.5788, lng: 91.8933 }, d: { lat: 25.5310, lng: 91.9280 }, vehicle: 'truck' },
  { name: 'Smit Village -> Laitlyngkot', o: { lat: 25.5310, lng: 91.9280 }, d: { lat: 25.4370, lng: 91.8340 }, vehicle: 'truck' },
];

async function runBenchmarks() {
  console.log('Running 10 Sample OD Latency Benchmarks on Real OSM Network...');
  const results = [];

  for (let i = 0; i < SAMPLE_OD_PAIRS.length; i++) {
    const pair = SAMPLE_OD_PAIRS[i];
    const t0 = performance.now();
    try {
      const res = await fetch('http://localhost:3000/api/v1/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: pair.o,
          destination: pair.d,
          vehicle: pair.vehicle,
          objective: 'safest',
          k: 3
        })
      });
      const data = await res.json();
      const elapsedMs = Math.round(performance.now() - t0);
      const route = data.routes?.[0];
      results.push({
        pair: pair.name,
        vehicle: pair.vehicle,
        elapsedMs,
        status: data.status,
        distanceKm: route?.distance_km || 0,
        etaMin: route?.estimated_travel_minutes || 0,
        coordCount: route?.coordinates?.length || 0,
        turnCount: route?.turn_instructions?.length || 0,
      });
      console.log(`[${i + 1}/10] ${pair.name} (${pair.vehicle}): ${elapsedMs} ms, ${route?.coordinates?.length || 0} coords, ${route?.distance_km} km`);
    } catch (err) {
      console.error(`Error on pair ${pair.name}:`, err.message);
    }
  }

  const times = results.map(r => r.elapsedMs).sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  console.log('\nBenchmark Summary:');
  console.log(`p50 Latency: ${p50} ms`);
  console.log(`p95 Latency: ${p95} ms`);
  console.log(`Avg Latency: ${avg} ms`);
  console.log(JSON.stringify(results, null, 2));
}

runBenchmarks();
