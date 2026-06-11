const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let code = fs.readFileSync(path, 'utf8');

// Remove the first duplicate purgeTodo (old one without action=purge)
const oldPurge = "async function purgeTodo(id) {\n  if (!confirm('\u5f7b\u5e95\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\uff1f')) return;\n  todoList = todoList.filter(function(t){ return t.id !== id; });\n  render();\n  var r = await todoApi('DELETE', null, id);\n  if (r && r.error) { toast('\u5f7b\u5e95\u5220\u9664\u5931\u8d25'); loadTodos(); }\n  else toast('\u5df2\u5f7b\u5e95\u5220\u9664');\n}\n\nasync function purgeTodo(id) {";

// Replace with just the new purgeTodo
code = code.replace(oldPurge, "async function purgeTodo(id) {");

// Also check for duplicate deleteTodo - the old one might still be there
let deleteCount = (code.match(/async function deleteTodo/g) || []).length;
console.log('deleteTodo count:', deleteCount);

let purgeCount = (code.match(/async function purgeTodo/g) || []).length;
console.log('purgeTodo count:', purgeCount);

// Check for Sortable init
console.log('Has Sortable init:', code.includes('Sortable.create'));
console.log('Has todo-list-container:', code.includes('todo-list-container'));
console.log('Has recycle bin chip:', code.includes("'\u56de\u6536\u7ad9'"));

fs.writeFileSync(path, code, 'utf8');
console.log('Fixed duplicate purgeTodo');
