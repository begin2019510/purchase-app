const fs = require('fs');

// Update version in utils.js
let utils = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\js\\utils.js', 'utf8');
utils = utils.replace(/APP_VERSION\s*=\s*['"][^'"]+['"]/, 'APP_VERSION = "3.9.0"');
fs.writeFileSync('D:\\OpenClawWorkspace\\purchase-app\\js\\utils.js', utils, 'utf8');

// Update cache bust versions in index.html
let html = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\index.html', 'utf8');
html = html.replace(/v=3\.[0-9]+\.[0-9]+/g, 'v=3.9.0');
fs.writeFileSync('D:\\OpenClawWorkspace\\purchase-app\\index.html', html, 'utf8');

console.log('Version updated to 3.9.0');
