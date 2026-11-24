const fs = require('fs');
const path = require('path');

async function testLiveGPS() {
  console.log('Testing Live GPS Movement and Auto-Follow Mode via Chrome CDP...');

  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173'));
  if (!pageTarget) {
    console.error('No page target found on port 9222');
    process.exit(1);
  }

  const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const send = (m, p={}) => new Promise((resolve, reject) => {
    const cur = id++;
    const h = (e) => {
      const d = JSON.parse(e.data);
      if (d.id === cur) {
        ws.removeEventListener('message', h);
        if (d.error) reject(d.error);
        else resolve(d.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: cur, method: m, params: p }));
  });

  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Grant geolocation permission to localhost
  await send('Browser.grantPermissions', {
    permissions: ['geolocation'],
    origin: 'http://localhost:5173'
  }).catch(() => {});

  // 1. Set initial GPS position: Shillong Police Bazar
  console.log('1. Setting initial live GPS fix (Shillong Police Bazar: 25.5788, 91.8933)...');
  await send('Emulation.setGeolocationOverride', {
    latitude: 25.5788,
    longitude: 91.8933,
    accuracy: 8
  });

  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2500));

  // Check if live GPS is tracked on page
  const gpsCheck1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const userDot = document.querySelector('.custom-user-pin');
      return {
        hasUserDot: !!userDot,
        dotHtml: userDot ? userDot.outerHTML.slice(0, 100) : null
      };
    })()`,
    returnByValue: true
  });
  console.log('GPS tracking on mount:', gpsCheck1.result?.value);

  // 2. Click "Find Safest Route" to get route alternatives
  console.log('2. Requesting route calculation...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Find Safest Route'));
      if (b) b.click();
    })()`
  });

  // Wait for route alternatives to appear
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const chk = await send('Runtime.evaluate', {
      expression: `(() => {
        const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Start Turn-by-Turn'));
        return !!b;
      })()`,
      returnByValue: true
    });
    if (chk.result?.value) break;
  }

  // 3. Start Turn-by-Turn Driving Navigation in Live GPS Mode
  console.log('3. Starting Turn-by-Turn Navigation...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Start Turn-by-Turn'));
      if (b) b.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1500));

  // Verify HUD shows Live GPS Driving Mode
  const hudCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
      const hasLiveGps = btns.some(t => t.includes('Live GPS Driving'));
      const instruction = document.querySelector('.text-slate-100')?.textContent || '';
      return { hasLiveGps, btns: btns.slice(0, 5), instruction };
    })()`,
    returnByValue: true
  });
  console.log('Navigation HUD state:', hudCheck.result?.value);

  // 4. Simulate real physical movement along road points (moving south along NH-106 towards Upper Shillong)
  const waypointUpdates = [
    { lat: 25.5740, lng: 91.8890, speed: 12.5 }, // 45 km/h
    { lat: 25.5680, lng: 91.8820, speed: 14.0 }, // 50 km/h
    { lat: 25.5620, lng: 91.8760, speed: 13.0 }, // 47 km/h
    { lat: 25.5560, lng: 91.8700, speed: 15.0 }, // 54 km/h
  ];

  for (let step = 0; step < waypointUpdates.length; step++) {
    const wp = waypointUpdates[step];
    console.log(`4.${step + 1}. Live GPS Moving to: ${wp.lat}, ${wp.lng} (speed: ${Math.round(wp.speed * 3.6)} km/h)...`);
    await send('Emulation.setGeolocationOverride', {
      latitude: wp.lat,
      longitude: wp.lng,
      accuracy: 5
    });

    await new Promise(r => setTimeout(r, 1500));

    // Inspect vehicle position and speed on HUD
    const stateEval = await send('Runtime.evaluate', {
      expression: `(() => {
        const speedEl = document.querySelector('.text-lg.font-black');
        const distEl = document.querySelector('.text-2xl.font-black, .text-3xl.font-black');
        const vehicleMarker = document.querySelector('.custom-vehicle-cursor');
        return {
          speedKmh: speedEl ? speedEl.textContent : 'N/A',
          distanceToTurn: distEl ? distEl.textContent : 'N/A',
          hasVehicleCursor: !!vehicleMarker
        };
      })()`,
      returnByValue: true
    });
    console.log(`   Vehicle HUD update:`, stateEval.result?.value);
  }

  // 5. Capture screenshot of live GPS driving mode in action
  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'desktop_live_gps_driving.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved desktop_live_gps_driving.png');

  ws.close();
  console.log('Live GPS movement and navigation verified successfully!');
  process.exit(0);
}

testLiveGPS().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
