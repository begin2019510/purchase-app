const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\todos.js';
let code = fs.readFileSync(path, 'utf8');

// Fix the garbled Chinese characters in the soft delete section
// The line should be: body: JSON.stringify({ fields: { '状态': '已删除' } }),
code = code.replace(
  "body: JSON.stringify({ fields: { '??': '???' } }),",
  "body: JSON.stringify({ fields: { '\u72b6\u6001': '\u5df2\u5220\u9664' } }),"
);

// Also fix the comment
code = code.replace(
  "// Soft delete: set status to ???",
  "// Soft delete: set status to \u5df2\u5220\u9664"
);

fs.writeFileSync(path, code, 'utf8');
console.log('Fixed garbled Chinese in todos.js');

// Verify
let check = fs.readFileSync(path, 'utf8');
let idx = check.indexOf('\u5df2\u5220\u9664');
console.log('Found deleted status at index:', idx);
