const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Add "回收站" to filter chips
code = code.replace(
  "var chips = ['全部', '待办', '进行中', '已完成', '高优先级', '已取消'];",
  "var chips = ['全部', '待办', '进行中', '已完成', '高优先级', '已取消', '回收站'];"
);

// 2. Update filter logic
code = code.replace(
  "if (todoFilter === '\u9ad8\u4f18\u5148\u7ea7') filtered = todoList.filter(function(t){ return t.priority === '\u9ad8' && t.status !== '\u5df2\u5b8c\u6210' && t.status !== '\u5df2\u53d6\u6d88'; });\n    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });",
  "if (todoFilter === '\u9ad8\u4f18\u5148\u7ea7') filtered = todoList.filter(function(t){ return t.priority === '\u9ad8' && t.status !== '\u5df2\u5b8c\u6210' && t.status !== '\u5df2\u53d6\u6d88' && t.status !== '\u5df2\u5220\u9664'; });\n    else if (todoFilter === '\u56de\u6536\u7ad9') filtered = todoList.filter(function(t){ return t.status === '\u5df2\u5220\u9664'; });\n    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });"
);

// 3. Update total to exclude deleted
code = code.replace(
  "var total=todoList.length, pending=0, doing=0, done=0, overdue=0;",
  "var total=todoList.filter(function(t){return t.status!=='\u5df2\u5220\u9664'}).length, pending=0, doing=0, done=0, overdue=0;"
);

// 4. Update deleteTodo for soft delete
code = code.replace(
  "async function deleteTodo(id) {\n  if (!confirm('\u786e\u5b9a\u5220\u9664\uff1f')) return;\n  closeTodoDetail();\n  todoList = todoList.filter(function(t){ return t.id !== id; });\n  render();\n  var r = await todoApi('DELETE', null, id);\n  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); loadTodos().then(function(){renderTodo()}); return; }\n  toast('\u5df2\u5220\u9664');\n}",
  "async function deleteTodo(id) {\n  if (!confirm('\u786e\u5b9a\u5220\u9664\uff1f')) return;\n  closeTodoDetail();\n  var t = todoList.find(function(x){ return x.id === id; });\n  var oldStatus = t ? t.status : null;\n  if (t) { t.status = '\u5df2\u5220\u9664'; }\n  render();\n  var r = await todoApi('DELETE', null, id);\n  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); if(t) t.status = oldStatus; render(); return; }\n  toast('\u5df2\u79fb\u5165\u56de\u6536\u7ad9');\n}"
);

// 5. Add recycle bin action buttons to card
code = code.replace(
  "h += '</div>'; // main\n  h += '</div></div>'; // inner + card\n  return h;",
  "h += '</div>'; // main\n  // Recycle bin actions\n  if (t.status === '\u5df2\u5220\u9664') {\n    h += '<div style=\"display:flex;gap:8px;padding:8px 18px 12px;border-top:1px solid var(--border)\">';\n    h += '<button onclick=\"event.stopPropagation();restoreTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid var(--pri);color:var(--pri);border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\\u21a9 \u6062\u590d</button>';\n    h += '<button onclick=\"event.stopPropagation();purgeTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid #ef4444;color:#ef4444;border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\\ud83d\uddd1\\ufe0f \u5f7b\u5e95\u5220\u9664</button>';\n    h += '</div>';\n  }\n  h += '</div></div>'; // inner + card\n  return h;"
);

// 6. Add purgeTodo function (before stringHashColor)
code = code.replace(
  "function stringHashColor(str) {",
  "async function purgeTodo(id) {\n  if (!confirm('\u5f7b\u5e95\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\uff1f')) return;\n  todoList = todoList.filter(function(t){ return t.id !== id; });\n  render();\n  try {\n    var url = TODO_API + '?id=' + id + '&action=purge';\n    var opts = { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };\n    var r = await fetch(url, opts);\n    var d = await r.json();\n    if (d && d.error) { toast('\u5f7b\u5e95\u5220\u9664\u5931\u8d25'); loadTodos(); }\n    else toast('\u5df2\u5f7b\u5e95\u5220\u9664');\n  } catch(e) { toast('\u5f7b\u5e95\u5220\u9664\u5931\u8d25'); loadTodos(); }\n}\n\nfunction stringHashColor(str) {"
);

// 7. Add SortableJS init in renderTodo
code = code.replace(
  "  // Animate progress bar\n  setTimeout(function() {\n    document.querySelectorAll('.todo-mini-fill[data-width]').forEach(function(el) {\n      el.style.width = el.getAttribute('data-width') + '%';\n    });\n  }, 50);\n}",
  "  // Animate progress bar\n  setTimeout(function() {\n    document.querySelectorAll('.todo-mini-fill[data-width]').forEach(function(el) {\n      el.style.width = el.getAttribute('data-width') + '%';\n    });\n  }, 50);\n\n  // Init SortableJS drag sort\n  if (typeof Sortable !== 'undefined' && todoView === 'list' && todoFilter !== '\u56de\u6536\u7ad9') {\n    var container = el.querySelector('.todo-list-container');\n    if (container) {\n      Sortable.create(container, {\n        animation: 200,\n        ghostClass: 'todo-drag-ghost',\n        handle: '.todo-card',\n        onEnd: function(evt) {\n          var cards = container.querySelectorAll('.todo-card');\n          var order = 0;\n          cards.forEach(function(card) {\n            var id = card.getAttribute('data-id');\n            var t = todoList.find(function(x){ return x.id === id; });\n            if (t) { t.order = order; todoApi('PUT', { id: id, order: order }); order++; }\n          });\n        }\n      });\n    }\n  }\n}"
);

// 8. Wrap list cards in container for SortableJS
code = code.replace(
  "    if (active.length > 0) {\n      active.forEach(function(t) { html += renderTodoCard(t); });\n    }",
  "    if (active.length > 0) {\n      html += '<div class=\"todo-list-container\">';\n      active.forEach(function(t) { html += renderTodoCard(t); });\n      html += '</div>';\n    }"
);

fs.writeFileSync(path, code, 'utf8');
console.log('todomodule.js updated successfully');
console.log('File size:', code.length, 'bytes');
