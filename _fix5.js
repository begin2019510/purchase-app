const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let code = fs.readFileSync(path, 'utf8');

// Fix deleteTodo to do soft delete
const oldDelete = "async function deleteTodo(id) {\n  if (!confirm('\u786e\u5b9a\u5220\u9664\uff1f')) return;\n  closeTodoDetail();\n  todoList = todoList.filter(function(t){ return t.id !== id; });\n  render();\n  var r = await todoApi('DELETE', null, id);\n  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); loadTodos().then(function(){renderTodo()}); return; }\n  toast('\u5df2\u5220\u9664');\n}";

const newDelete = "async function deleteTodo(id) {\n  if (!confirm('\u786e\u5b9a\u5220\u9664\uff1f')) return;\n  closeTodoDetail();\n  var t = todoList.find(function(x){ return x.id === id; });\n  var oldStatus = t ? t.status : null;\n  if (t) { t.status = '\u5df2\u5220\u9664'; }\n  render();\n  var r = await todoApi('DELETE', null, id);\n  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); if(t) t.status = oldStatus; render(); return; }\n  toast('\u5df2\u79fb\u5165\u56de\u6536\u7ad9');\n}";

if (code.includes(oldDelete)) {
  code = code.replace(oldDelete, newDelete);
  console.log('Fixed deleteTodo to soft delete');
} else {
  console.log('Old deleteTodo pattern not found');
  // Try line-based fix
  let lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('async function deleteTodo')) {
      console.log('Found deleteTodo at line', i+1);
      // Replace lines i through i+8
      lines[i+2] = "  closeTodoDetail();";
      lines[i+3] = "  var t = todoList.find(function(x){ return x.id === id; });";
      lines[i+4] = "  var oldStatus = t ? t.status : null;";
      lines[i+5] = "  if (t) { t.status = '\u5df2\u5220\u9664'; }";
      lines[i+6] = "  render();";
      lines[i+7] = "  var r = await todoApi('DELETE', null, id);";
      lines[i+8] = "  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); if(t) t.status = oldStatus; render(); return; }";
      lines[i+9] = "  toast('\u5df2\u79fb\u5165\u56de\u6536\u7ad9');";
      break;
    }
  }
  code = lines.join('\n');
  fs.writeFileSync(path, code, 'utf8');
  console.log('Fixed deleteTodo via line replacement');
}
