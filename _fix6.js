const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Fix line 1052 (0-indexed 1051) - add closing brace after toast
// Current line 1052: "  toast('已移入回收站');"
// Need to add "}" after it
if (lines[1051] && lines[1051].includes("\u5df2\u79fb\u5165\u56de\u6536\u7ad9")) {
  lines.splice(1052, 0, '}');
  console.log('Added closing brace for deleteTodo at line 1053');
} else {
  console.log('Pattern not found at line 1052:', lines[1051]);
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Done. Lines:', lines.length);
