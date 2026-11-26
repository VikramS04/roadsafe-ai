const fs = require('fs');
const path = require('path');

async function run() {
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No Chrome page target found');

  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const send = (m, p = {}) =>
    new Promise((resolve, reject) => {
      const c = id++;
      const h = (e) => {
        const d = JSON.parse(e.data);
        if (d.id === c) {
          ws.removeEventListener('message', h);
          if (d.error) reject(d.error);
          else resolve(d.result);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id: c, method: m, params: p }));
    });

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Browser.grantPermissions', {
    permissions: ['geolocation'],
    origin: 'http://localhost:5173',
  }).catch(() => {});

  // 1. Mobile Navigation Screenshot (390x844)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setGeolocationOverride', {
    latitude: 25.574,
    longitude: 91.889,
    accuracy: 6,
    speed: 12,
    heading: 195,
  });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise((r) => setTimeout(r, 3000));

  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const startBtn = btns.find(b => b.textContent && b.textContent.includes('Start Driving'));
      if (startBtn) startBtn.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1500));
  const navShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '../docs/screenshots/mobile_navigation_390.png'), Buffer.from(navShot.data, 'base64'));
  console.log('Saved docs/screenshots/mobile_navigation_390.png');

  // 2. Admin Queue & Detail Screenshots (1280x800)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173/admin' });
  await new Promise((r) => setTimeout(r, 1500));

  // Sign in using the CLI-seeded test admin
  await send('Runtime.evaluate', {
    expression: `(() => {
      const email = document.querySelector('#admin-email');
      const pass = document.querySelector('#admin-password');
      if (email && pass) {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setVal(email, 'admin@roadsafe.local');
        setVal(pass, 'StrongAdminPassword!2026');
        document.querySelector('button[type="submit"]').click();
      }
    })()`,
  });
  await new Promise((r) => setTimeout(r, 2000));

  const queueShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '../docs/screenshots/admin_queue.png'), Buffer.from(queueShot.data, 'base64'));
  console.log('Saved docs/screenshots/admin_queue.png');

  // Click first "Review" button to open Hazard Detail
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const rev = btns.find(b => b.textContent && b.textContent.trim() === 'Review');
      if (rev) rev.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1500));

  const detailShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '../docs/screenshots/admin_detail.png'), Buffer.from(detailShot.data, 'base64'));
  console.log('Saved docs/screenshots/admin_detail.png');

  ws.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
