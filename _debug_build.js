const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\www\\js\\items.js';
let c = fs.readFileSync(path, 'utf8');
// Add debug logging at the top of switchTab
c = c.replace(
  "function switchTab(t){\n  currentTab=t;",
  "function switchTab(t){\n  console.log('SWITCHTAB:',t,'projDisplay:',document.getElementById('tab-project')?.style.display);\n  currentTab=t;"
);
fs.writeFileSync(path, c, 'utf8');
fs.copyFileSync(path, 'D:\\OpenClawWorkspace\\purchase-app\\js\\items.js');
// Rebuild
const { execSync } = require('child_process');
process.chdir('D:\\OpenClawWorkspace\\purchase-app');
execSync('npx cap sync android', {stdio:'pipe'});
process.chdir('android');
execSync('.\\gradlew.bat assembleDebug --no-daemon', {stdio:'pipe'});
process.chdir('..');
execSync('"D:\\AndroidSDK\\platform-tools\\adb.exe" install -r android\\app\\build\\outputs\\apk\\debug\\app-debug.apk', {stdio:'inherit'});
execSync('"D:\\AndroidSDK\\platform-tools\\adb.exe" shell am force-stop com.home.app', {stdio:'pipe'});
execSync('"D:\\AndroidSDK\\platform-tools\\adb.exe" shell pm clear com.home.app', {stdio:'pipe'});
execSync('"D:\\AndroidSDK\\platform-tools\\adb.exe" shell am start -n com.home.app/.MainActivity', {stdio:'inherit'});
console.log('Done. Wait 15s then check logcat.');
