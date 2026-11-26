const fs = require('fs');

async function run() {
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No Chrome page target found on port 9222');

  const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const consoleErrors = [];
  const networkFailures = [];
  const apiCalls = [];

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
    if (d.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(d.params.exceptionDetails?.text || 'Uncaught exception');
    }
    if (d.method === 'Network.responseReceived') {
      const { url, status } = d.params.response;
      if (url.includes('/api/v1/')) {
        apiCalls.push({ url: url.replace('http://localhost:5173', ''), status });
        if (status >= 400) networkFailures.push({ url, status });
      }
    }
  });

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Browser.grantPermissions', {
    permissions: ['geolocation'],
    origin: 'http://localhost:5173',
  }).catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // Step 1: Clean app state
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await new Promise((r) => setTimeout(r, 2500));

  const step1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const orig = document.querySelector('input[aria-label="Origin location"]')?.value;
      const dest = document.querySelector('input[aria-label="Destination location"]')?.value;
      const hasSheet = !!document.body.innerText.includes('Route Rationale');
      return { orig, dest, hasSheet };
    })()`,
    returnByValue: true,
  });
  console.log('STEP 1 (Clean state):', JSON.stringify(step1.result.value));

  // Step 2: Search origin "Police Bazar" and select
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('input[aria-label="Origin location"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'Police Bazar');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1800));
  const origOpts = await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('[aria-label="Origin suggestions"] [role="option"]')).map(o => o.innerText)`,
    returnByValue: true,
  });
  console.log('STEP 2 (Origin options):', JSON.stringify(origOpts.result.value));
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Origin suggestions"] [role="option"]')?.click()`,
  });
  await new Promise((r) => setTimeout(r, 400));

  // Step 3: Search destination "Cherrapunji" and select
  await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('input[aria-label="Destination location"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'Cherrapunji');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  });
  await new Promise((r) => setTimeout(r, 1800));
  const destOpts = await send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('[aria-label="Destination suggestions"] [role="option"]')).map(o => o.innerText)`,
    returnByValue: true,
  });
  console.log('STEP 3 (Dest options):', JSON.stringify(destOpts.result.value));
  await send('Runtime.evaluate', {
    expression: `document.querySelector('[aria-label="Destination suggestions"] [role="option"]')?.click()`,
  });

  // Step 4 & 5: Wait for route computation
  await new Promise((r) => setTimeout(r, 5000));
  const step5 = await send('Runtime.evaluate', {
    expression: `(() => {
      const orig = document.querySelector('input[aria-label="Origin location"]')?.value;
      const dest = document.querySelector('input[aria-label="Destination location"]')?.value;
      const openListboxes = document.querySelectorAll('[role="listbox"]').length;
      const bodyText = document.body.innerText;
      const hasRoute = bodyText.includes('Route Rationale') || bodyText.includes('Lowest Risk');
      const hasError = bodyText.includes('Unable to Route');
      const errMsg = document.querySelector('.bg-rose-950\\/90')?.innerText || null;
      return { orig, dest, openListboxes, hasRoute, hasError, errMsg };
    })()`,
    returnByValue: true,
  });
  console.log('STEP 4-5 (Route result for Police Bazar -> Cherrapunji):', JSON.stringify(step5.result.value));

  // Step 6: Switch vehicle to Truck and objective to Fastest
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      btns.find(b => b.textContent && b.textContent.includes('Truck'))?.click();
      btns.find(b => b.textContent && b.textContent.includes('Fastest'))?.click();
    })()`,
  });
  await new Promise((r) => setTimeout(r, 4000));
  const step6 = await send('Runtime.evaluate', {
    expression: `(() => {
      const errMsg = document.querySelector('.bg-rose-950\\/90')?.innerText || null;
      const hasRoute = document.body.innerText.includes('Route Rationale');
      return { hasRoute, errMsg };
    })()`,
    returnByValue: true,
  });
  console.log('STEP 6 (Truck + Fastest):', JSON.stringify(step6.result.value));

  console.log('API CALLS:', JSON.stringify(apiCalls));
  console.log('NETWORK FAILURES:', JSON.stringify(networkFailures));
  console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors));
  ws.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
