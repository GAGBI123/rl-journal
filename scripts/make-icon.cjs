// Renders the app icon (SVG) to PNG using Electron's offscreen rendering.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// The icon's source is build/icon.svg (the app's sidebar shows the same file).
const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');

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
