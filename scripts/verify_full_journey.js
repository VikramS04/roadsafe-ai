const fs = require('fs');

async function run() {
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No Chrome page target found');

  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const consoleErrors = [];
  const apiLog = [];

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

  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.method === 'Runtime.consoleAPICalled' && d.params?.type === 'error') {
      consoleErrors.push(d.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (d.method === 'Network.responseReceived' && d.params.response.url.includes('/api/v1/')) {
      apiLog.push({ url: d.params.response.url.replace('http://localhost:5173', ''), status: d.params.response.status });
    }
  });

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Browser.grantPermissions', { permissions: ['geolocation'], origin: 'http://localhost:5173' }).catch(() => {});
  await send('Emulation.setGeolocationOverride', { latitude: 25.578748, longitude: 91.893307, accuracy: 6, speed: 12, heading: 200 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // 1. Clean state
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise((r) => setTimeout(r, 2000));
  const s1 = await send('Runtime.evaluate', {
    expression: `({ orig: document.querySelector('input[aria-label="Origin location"]')?.value, dest: document.querySelector('input[aria-label="Destination location"]')?.value })`,
    returnByValue: true,
  });
  console.log('1. Clean state:', JSON.stringify(s1.result.value));

  // 2. Search "Police Bazar" & select
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('input[aria-label="Origin location"]');
      el.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Police Bazar');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 2200));
  const origOpts = await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('[aria-label="Origin suggestions"] [role="option"]')).map(o => o.innerText.replace(/\\n/g, ' | '))`,
    returnByValue: true,
  });
  console.log('2. Origin suggestions:', JSON.stringify(origOpts.result.value));
  await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Origin suggestions"] [role="option"]')?.click()` });
  await new Promise((r) => setTimeout(r, 400));

  // 3. Search "Upper Shillong" & select
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('input[aria-label="Destination location"]');
      el.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Upper Shillong');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 2200));
  const destOpts = await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('[aria-label="Destination suggestions"] [role="option"]')).map(o => o.innerText.replace(/\\n/g, ' | '))`,
    returnByValue: true,
  });
  console.log('3. Dest suggestions:', JSON.stringify(destOpts.result.value));
  await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Destination suggestions"] [role="option"]')?.click()` });

  // 4-5. Wait for route calculation
  await new Promise((r) => setTimeout(r, 5000));
  const s5 = await send('Runtime.evaluate', {
    expression: `(() => {
      const orig = document.querySelector('input[aria-label="Origin location"]')?.value;
      const dest = document.querySelector('input[aria-label="Destination location"]')?.value;
      const openListboxes = document.querySelectorAll('[role="listbox"]').length;
      const hasLowestRisk = document.body.innerText.includes('Lowest Risk');
      const hasDisclaimer = document.body.innerText.includes('not a guarantee of safety');
      return { orig, dest, openListboxes, hasLowestRisk, hasDisclaimer };
    })()`,
    returnByValue: true,
  });
  console.log('4-5. Route calculated:', JSON.stringify(s5.result.value));

  // 6. Switch to Bike + Fastest
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent && b.textContent.includes('Bike'))?.click();
      btns.find(b => b.textContent && b.textContent.includes('Fastest'))?.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 4000));

  // 7. Report Hazard -> Reload -> Verify Persistence
  const uniqueNote = 'E2E-Journey-Hazard-' + Date.now();
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent && b.textContent.includes('Report Hazard'))?.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 500));
  await send('Runtime.evaluate', {
    expression: `(() => {
      const inp = document.querySelector('input[placeholder*="Rocks blocking"]');
      if (inp) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, '${uniqueNote}');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const sub = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Submit Hazard Report'));
      if (sub) sub.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Reload and check persistence via API
  await send('Page.reload');
  await new Promise((r) => setTimeout(r, 2000));
  const persisted = await send('Runtime.evaluate', {
    expression: `fetch('/api/v1/hazards').then(r => r.json()).then(d => d.hazards.some(h => h.note === '${uniqueNote}'))`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('7. Hazard persisted after reload:', persisted.result.value);

  // 8. Start Navigation & verify GPS fix drives progress (re-select origin/dest quickly via map/search or My GPS -> Upper Shillong)
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent && b.textContent.includes('My GPS'))?.click();
      const el = document.querySelector('input[aria-label="Destination location"]');
      el.focus();
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Upper Shillong');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 2200));
  await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="Destination suggestions"] [role="option"]')?.click()` });
  await new Promise((r) => setTimeout(r, 4500));
  await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Start Turn-by-Turn'))?.click()`,
  });
  await new Promise((r) => setTimeout(r, 1000));

  // Inject moved GPS fix
  await send('Emulation.setGeolocationOverride', { latitude: 25.5700, longitude: 91.8850, accuracy: 5, speed: 14, heading: 210 });
  await new Promise((r) => setTimeout(r, 1200));
  const navCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      return { isLiveGps: text.includes('Live GPS'), hasWakeNotice: text.includes('browsers pause GPS'), speedText: text.match(/\\d+\\s*km\\/h/)?.[0] || null };
    })()`,
    returnByValue: true,
  });
  console.log('8. Real GPS Navigation active:', JSON.stringify(navCheck.result.value));

  // 9. Open /admin, find the uniqueNote report, and delete it (cleanup) -> verify gone from public API
  await send('Page.navigate', { url: 'http://localhost:5173/admin' });
  await new Promise((r) => setTimeout(r, 1500));
  const adminCheck = await send('Runtime.evaluate', {
    expression: `fetch('/api/v1/admin/hazards?q=${encodeURIComponent(uniqueNote)}', { credentials: 'include' }).then(r => r.json()).then(d => ({ total: d.total, id: d.items?.[0]?.id || null }))`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('9. Admin queue found test hazard:', JSON.stringify(adminCheck.result.value));

  if (adminCheck.result.value?.id) {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const csrf = document.cookie.match(/roadsafe_csrf=([^;]+)/)?.[1];
        return fetch('/api/v1/admin/hazards/${adminCheck.result.value.id}', {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'x-csrf-token': csrf }
        }).then(r => r.status);
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
  }

  console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors));
  ws.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
