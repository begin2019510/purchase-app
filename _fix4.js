const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Find line 167 (0-indexed 166) which is the closing brace of renderTodo
// Insert SortableJS init before it
let insertIdx = -1;
for (let i = 150; i < 175; i++) {
  if (lines[i] && lines[i].trim() === '}' && i > 0 && lines[i-1].includes('50);')) {
    insertIdx = i;
    break;
  }
}

if (insertIdx > 0) {
  const sortableCode = [
    '',
    '  // Init SortableJS drag sort',
    "  if (typeof Sortable !== 'undefined' && todoView === 'list' && todoFilter !== '\u56de\u6536\u7ad9') {",
    "    var container = el.querySelector('.todo-list-container');",
    '    if (container) {',
    '      Sortable.create(container, {',
    '        animation: 200,',
    "        ghostClass: 'todo-drag-ghost',",
    "        handle: '.todo-card',",
    '        onEnd: function(evt) {',
    "          var cards = container.querySelectorAll('.todo-card');",
    '          var order = 0;',
    '          cards.forEach(function(card) {',
    "            var id = card.getAttribute('data-id');",
    "            var t = todoList.find(function(x){ return x.id === id; });",
    "            if (t) { t.order = order; todoApi('PUT', { id: id, order: order }); order++; }",
    '          });',
    '        }',
    '      });',
    '    }',
    '  }',
  ];
  lines.splice(insertIdx, 0, ...sortableCode);
  console.log('Inserted SortableJS init at line', insertIdx + 1);
} else {
  console.log('Could not find insertion point, insertIdx=' + insertIdx);
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Done. Lines:', lines.length);
