const fs = require('fs');
const path = require('path');

async function run() {
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('No Chrome page target found');

  const ws = new globalThis.WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const cur = id++;
      const handler = (e) => {
        const d = JSON.parse(e.data);
        if (d.id === cur) {
          ws.removeEventListener('message', handler);
          if (d.error) reject(d.error);
          else resolve(d.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: cur, method, params }));
    });

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise((r) => setTimeout(r, 2500));

  // Focus destination input and trigger search
  await send('Runtime.evaluate', {
    expression: `(() => {
      const destInput = document.querySelector('input[placeholder*="Destination"]');
      if (destInput) {
        destInput.focus();
      }
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1200));

  // Click Report Hazard button while destination dropdown is still open (demonstrating leak/stale dropdown)
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const rep = btns.find(b => b.textContent && b.textContent.includes('Report Hazard'));
      if (rep) rep.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 800));

  const check = await send('Runtime.evaluate', {
    expression: `(() => {
      const dropdown = document.querySelector('.z-50.divide-y');
      return { dropdownStillVisible: !!dropdown, dropdownText: dropdown ? dropdown.textContent.slice(0, 80) : null };
    })()`,
    returnByValue: true,
  });
  console.log('Task 2 reproduction check:', JSON.stringify(check.result.value));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '../docs/screenshots/task2_before.png'), Buffer.from(shot.data, 'base64'));
  console.log('Saved docs/screenshots/task2_before.png');
  ws.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
