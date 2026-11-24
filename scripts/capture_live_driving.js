const fs = require('fs');
const path = require('path');

async function main() {
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('localhost:5173'));
  if (!pageTarget) {
    console.error('No page target found');
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

  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');

  // 1. Reload clean Desktop 1440x900
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2000));

  // Click "Find Safest Route"
  console.log('Clicking Find Safest Route...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Find Safest Route'));
      if (b) b.click();
    })()`
  });

  // Wait for route computation
  console.log('Waiting for route calculation...');
  let navFound = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const chk = await send('Runtime.evaluate', {
      expression: `(() => {
        const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Start Turn-by-Turn'));
        return !!b;
      })()`,
      returnByValue: true
    });
    if (chk.result?.value) {
      navFound = true;
      break;
    }
  }
  console.log('Nav button found:', navFound);

  // Capture desktop route
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'desktop_routes_1440.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Captured desktop_routes_1440.png');

  if (navFound) {
    console.log('Starting driving navigation...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Start Turn-by-Turn'));
        if (b) b.click();
      })()`
    });

    // Let simulation run for 2.5 seconds along the curved road
    await new Promise(r => setTimeout(r, 2500));
    shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(screenshotsDir, 'desktop_driving_navigation.png'), Buffer.from(shot.data, 'base64'));
    console.log('✓ Captured desktop_driving_navigation.png (live HUD on true curvature)');
  }

  // 2. Mobile Viewport 390x844
  console.log('Setting viewport to Mobile 390x844...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2000));

  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Find Safest Route'));
      if (b) b.click();
    })()`
  });

  // Wait for route computation
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

  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'mobile_routes_390.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Captured mobile_routes_390.png');

  // Open 2-tap Hazard report on mobile
  await send('Runtime.evaluate', {
    expression: `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Report Hazard'));
      if (b) b.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1000));

  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'mobile_hazard_modal_390.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Captured mobile_hazard_modal_390.png');

  ws.close();
  console.log('All audit captures complete!');
}

main().catch(console.error);
