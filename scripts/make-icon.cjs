// Renders the app icon (SVG) to PNG using Electron's offscreen rendering.
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2f7cf6"/>
      <stop offset="0.55" stop-color="#6d5dfc"/>
      <stop offset="1" stop-color="#f0782f"/>
    </linearGradient>
    <radialGradient id="b" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#dfe5f2"/>
      <stop offset="1" stop-color="#8f9ab3"/>
    </radialGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="#070b16" opacity="0.18"/>
  <path d="M96 330 L210 300" stroke="#ffffff" stroke-opacity="0.55" stroke-width="22" stroke-linecap="round"/>
  <path d="M80 270 L196 254" stroke="#ffffff" stroke-opacity="0.35" stroke-width="16" stroke-linecap="round"/>
  <circle cx="300" cy="248" r="124" fill="url(#b)"/>
  <circle cx="300" cy="248" r="84" fill="none" stroke="#0b1122" stroke-opacity="0.55" stroke-width="18"/>
  <circle cx="300" cy="248" r="30" fill="#0b1122" fill-opacity="0.55"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`),
  );
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const png = img.resize({ width: 512, height: 512 }).toPNG();
  for (const dir of ['build', 'assets']) {
    fs.mkdirSync(path.join(__dirname, '..', dir), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', dir, 'icon.png'), png);
  }
  console.log('icon written', png.length, 'bytes');
  app.quit();
});
