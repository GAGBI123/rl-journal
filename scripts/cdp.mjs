// Minimal Chrome DevTools Protocol driver for screenshotting the running app.
// Usage: node scripts/cdp.mjs <port> <outDir> <step.json> [page url contains, e.g. overlay.html]
// step file: [{ "eval": "js", "wait": 300, "shot": "name" }, ...]
import WebSocket from 'ws';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [port, outDir, stepsFile, urlFilter] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = targets.filter((t) => t.type === 'page' && !t.url.startsWith('devtools'));
const page = urlFilter ? pages.find((t) => t.url.includes(urlFilter)) : pages.find((t) => !t.url.includes('overlay.html')) ?? pages[0];
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (m) => {
  const msg = JSON.parse(m.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');
for (const step of steps) {
  if (step.eval) {
    const r = await send('Runtime.evaluate', { expression: step.eval, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
    if (v !== undefined) console.log('eval:', typeof v === 'string' ? v.slice(0, 400) : JSON.stringify(v).slice(0, 400));
  }
  if (step.wait) await sleep(step.wait);
  if (step.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${step.shot}.png`), Buffer.from(r.result.data, 'base64'));
    console.log('shot', step.shot);
  }
}
ws.close();
