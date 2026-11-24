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

  console.log('Connecting to page:', pageTarget.webSocketDebuggerUrl);
  const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);

  let idCounter = 1;
  const pending = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  console.log('Connected to CDP');

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Desktop Viewport 1440x900
  console.log('Setting viewport to Desktop 1440x900...');
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  // Navigate / reload to ensure fresh layout
  await sendCommand('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2500));

  // Take screenshot: Desktop Home
  let shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'desktop_home_1440.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved desktop_home_1440.png');

  // Trigger Route Search
  console.log('Triggering route search via UI...');
  await sendCommand('Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const findBtn = btns.find(b => b.textContent.includes('Find Safest Route') || b.textContent.includes('Get Routes') || b.textContent.includes('Safest'));
        if (findBtn) {
          findBtn.click();
          return 'Clicked find button: ' + findBtn.textContent;
        }
        return 'No find button found';
      })()
    `
  });

  // Wait for routing engine to respond and draw polylines
  await new Promise(r => setTimeout(r, 3500));

  shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'desktop_routes_1440.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved desktop_routes_1440.png');

  // Click "Start Driving / Navigation"
  console.log('Clicking Start Navigation...');
  const navClick = await sendCommand('Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const navBtn = btns.find(b => b.textContent.includes('Start Driving') || b.textContent.includes('Start Navigation') || b.textContent.includes('Drive'));
        if (navBtn) {
          navBtn.click();
          return 'Clicked: ' + navBtn.textContent;
        }
        return 'Nav button not found';
      })()
    `
  });
  console.log('Nav button result:', navClick.result?.value);

  // Wait 3s of navigation simulation
  await new Promise(r => setTimeout(r, 3000));
  shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'desktop_driving_navigation.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved desktop_driving_navigation.png');

  // 2. Mobile Viewport 390x844 (iPhone 13/14)
  console.log('Setting viewport to Mobile 390x844...');
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  // Reload on mobile
  await sendCommand('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise(r => setTimeout(r, 2500));

  // Trigger route on mobile
  await sendCommand('Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const findBtn = btns.find(b => b.textContent.includes('Find Safest Route') || b.textContent.includes('Get Routes') || b.textContent.includes('Safest'));
        if (findBtn) findBtn.click();
      })()
    `
  });
  await new Promise(r => setTimeout(r, 3500));

  shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'mobile_routes_390.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved mobile_routes_390.png');

  // Open Report Hazard Modal
  console.log('Opening Hazard Report modal on mobile...');
  await sendCommand('Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const reportBtn = btns.find(b => b.textContent.includes('Report') || b.getAttribute('aria-label')?.includes('Report'));
        if (reportBtn) {
          reportBtn.click();
          return 'Clicked report button';
        }
        return 'Report button not found';
      })()
    `
  });
  await new Promise(r => setTimeout(r, 1500));

  shot = await sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(screenshotsDir, 'mobile_hazard_modal_390.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ Saved mobile_hazard_modal_390.png');

  ws.close();
  console.log('All audit screenshots captured successfully!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
