const fs = require('fs');
const code = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\todos.js', 'utf8');
const idx = code.indexOf("method === 'DELETE'");
console.log(code.substring(idx, idx + 800));
