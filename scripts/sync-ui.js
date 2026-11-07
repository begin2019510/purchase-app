// Mirror the Cloudflare Pages frontend into Capacitor's webDir after source edits.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'www');
for (const name of ['index.html', 'theme.css', 'sw.js', 'ui-refresh.css', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png']) {
  fs.copyFileSync(path.join(root, name), path.join(webDir, name));
}
const sourceJs = path.join(root, 'js');
const targetJs = path.join(webDir, 'js');
fs.mkdirSync(targetJs, { recursive: true });
for (const name of fs.readdirSync(sourceJs)) {
  if (name.endsWith('.js')) fs.copyFileSync(path.join(sourceJs, name), path.join(targetJs, name));
}
