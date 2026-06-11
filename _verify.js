const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\todos.js';
let code = fs.readFileSync(path, 'utf8');
// Find the DELETE handler and show it
let idx = code.indexOf("method === 'DELETE'");
console.log(code.substring(idx, idx + 600));
