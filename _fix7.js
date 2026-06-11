const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Fix filter logic at lines 48-51 (0-indexed 47-50)
// Current:
//   if (todoFilter !== '全部') {
//     if (todoFilter === '高优先级') filtered = todoList.filter(function(t){ return t.priority === '高' && t.status !== '已完成' && t.status !== '已取消'; });
//     else filtered = todoList.filter(function(t){ return t.status === todoFilter; });
//   }
// Need to add recycle bin filter and exclude deleted from normal views

lines[47] = "  if (todoFilter !== '\u5168\u90e8') {";
lines[48] = "    if (todoFilter === '\u9ad8\u4f18\u5148\u7ea7') filtered = todoList.filter(function(t){ return t.priority === '\u9ad8' && t.status !== '\u5df2\u5b8c\u6210' && t.status !== '\u5df2\u53d6\u6d88' && t.status !== '\u5df2\u5220\u9664'; });";
lines[49] = "    else if (todoFilter === '\u56de\u6536\u7ad9') filtered = todoList.filter(function(t){ return t.status === '\u5df2\u5220\u9664'; });";
lines[50] = "    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });";
lines[51] = "  } else {";
// Insert new line to exclude deleted from 'all' view
lines.splice(52, 0, "    filtered = todoList.filter(function(t){ return t.status !== '\u5df2\u5220\u9664'; });");
lines.splice(53, 0, "  }");

// Now we have an extra closing brace. Let me check what was at line 51 before.
// Actually line 51 was "  }" which is now the closing of the if-else block.
// But we added " } else {" at line 51 and "  }" at line 53.
// The original "  }" at line 51 needs to be removed since we replaced it.

// Wait, let me re-think. The original structure was:
// if (todoFilter !== '全部') {
//   ... filter logic ...
// }
// 
// Now I want:
// if (todoFilter !== '全部') {
//   ... filter logic including recycle bin ...
// } else {
//   filtered = todoList.filter(function(t){ return t.status !== '已删除'; });
// }

// The issue is that line 51 was originally "  }" (closing the if block).
// I changed it to "  } else {" and added new lines. But I need to make sure
// the structure is correct.

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Fixed filter logic');
// Verify
let code = fs.readFileSync(path, 'utf8');
let idx = code.indexOf("todoFilter !== '\u5168\u90e8'");
console.log('Filter block at char index:', idx);
console.log('Context:', code.substring(idx, idx + 500));
