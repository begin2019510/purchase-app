const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Find all purgeTodo function declarations
let purgeLocations = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('async function purgeTodo')) {
    purgeLocations.push(i);
  }
}
console.log('purgeTodo at lines:', purgeLocations.map(l => l+1));

// Remove the first one (lines 1082-1089, 0-indexed 1081-1088)
if (purgeLocations.length >= 2) {
  let start = purgeLocations[0]; // 0-indexed
  // Find the closing brace
  let end = start;
  let braceCount = 0;
  for (let i = start; i < lines.length; i++) {
    for (let c of lines[i]) {
      if (c === '{') braceCount++;
      if (c === '}') braceCount--;
    }
    if (braceCount === 0) { end = i; break; }
  }
  // Also remove blank line after
  lines.splice(start, end - start + 1);
  console.log('Removed lines', start+1, 'to', end+1);
}

// Also check if Sortable/todo-list-container were applied
let code = lines.join('\n');
console.log('Has Sortable:', code.includes('Sortable.create'));
console.log('Has todo-list-container:', code.includes('todo-list-container'));

// If not, add them
if (!code.includes('Sortable.create')) {
  // Find the renderTodo closing
  let renderEnd = code.indexOf("  // Animate progress bar\n  setTimeout(function() {\n    document.querySelectorAll('.todo-mini-fill[data-width]').forEach(function(el) {\n      el.style.width = el.getAttribute('data-width') + '%';\n    });\n  }, 50);\n}");
  if (renderEnd >= 0) {
    let insertAt = renderEnd + "  // Animate progress bar\n  setTimeout(function() {\n    document.querySelectorAll('.todo-mini-fill[data-width]').forEach(function(el) {\n      el.style.width = el.getAttribute('data-width') + '%';\n    });\n  }, 50);".length;
    let sortableCode = `\n\n  // Init SortableJS drag sort
  if (typeof Sortable !== 'undefined' && todoView === 'list' && todoFilter !== '\u56de\u6536\u7ad9') {
    var container = el.querySelector('.todo-list-container');
    if (container) {
      Sortable.create(container, {
        animation: 200,
        ghostClass: 'todo-drag-ghost',
        handle: '.todo-card',
        onEnd: function(evt) {
          var cards = container.querySelectorAll('.todo-card');
          var order = 0;
          cards.forEach(function(card) {
            var id = card.getAttribute('data-id');
            var t = todoList.find(function(x){ return x.id === id; });
            if (t) { t.order = order; todoApi('PUT', { id: id, order: order }); order++; }
          });
        }
      });
    }
  }`;
    code = code.slice(0, insertAt) + sortableCode + code.slice(insertAt);
    console.log('Added SortableJS init');
  } else {
    console.log('Could not find renderTodo end pattern');
  }
}

if (!code.includes('todo-list-container')) {
  code = code.replace(
    "    if (active.length > 0) {\n      active.forEach(function(t) { html += renderTodoCard(t); });\n    }",
    "    if (active.length > 0) {\n      html += '<div class=\"todo-list-container\">';\n      active.forEach(function(t) { html += renderTodoCard(t); });\n      html += '</div>';\n    }"
  );
  console.log('Added todo-list-container wrapper');
}

fs.writeFileSync(path, code, 'utf8');
console.log('Final file size:', code.length);
