const fs = require('fs');
const path = 'D:\\OpenClawWorkspace\\purchase-app\\js\\todomodule.js';
let code = fs.readFileSync(path, 'utf8');

// Add recycle bin actions to card
const oldEnd = "  h += '</div>'; // main\n  h += '</div></div>'; // inner + card\n  return h;";
const newEnd = "  h += '</div>'; // main\n  // Recycle bin actions\n  if (t.status === '\u5df2\u5220\u9664') {\n    h += '<div style=\"display:flex;gap:8px;padding:8px 18px 12px;border-top:1px solid var(--border)\">';\n    h += '<button onclick=\"event.stopPropagation();restoreTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid var(--pri);color:var(--pri);border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\u21a9 \u6062\u590d</button>';\n    h += '<button onclick=\"event.stopPropagation();purgeTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid #ef4444;color:#ef4444;border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\ud83d\uddd1\ufe0f \u5f7b\u5e95\u5220\u9664</button>';\n    h += '</div>';\n  }\n  h += '</div></div>'; // inner + card\n  return h;";

if (code.includes(oldEnd)) {
  code = code.replace(oldEnd, newEnd);
  console.log('Added recycle bin actions to card');
} else {
  console.log('Pattern not found - trying line-based');
  let lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("// inner + card") && lines[i].includes("return h") === false) {
      // Check if this is the renderTodoCard function (not other functions)
      // Look backwards for the function declaration
      for (let j = i; j >= Math.max(0, i-120); j--) {
        if (lines[j].includes('function renderTodoCard')) {
          // Found it! Insert recycle bin actions before this line
          let insertLines = [
            "  // Recycle bin actions",
            "  if (t.status === '\u5df2\u5220\u9664') {",
            "    h += '<div style=\"display:flex;gap:8px;padding:8px 18px 12px;border-top:1px solid var(--border)\">';",
            "    h += '<button onclick=\"event.stopPropagation();restoreTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid var(--pri);color:var(--pri);border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\u21a9 \u6062\u590d</button>';",
            "    h += '<button onclick=\"event.stopPropagation();purgeTodo(\\x27' + t.id + '\\x27)\" style=\"flex:1;padding:6px;border:1px solid #ef4444;color:#ef4444;border-radius:8px;background:transparent;cursor:pointer;font-size:12px\">\ud83d\uddd1\ufe0f \u5f7b\u5e95\u5220\u9664</button>';",
            "    h += '</div>';",
            "  }",
          ];
          lines.splice(i, 0, ...insertLines);
          console.log('Inserted recycle bin actions at line', i+1);
          break;
        }
      }
      break;
    }
  }
  code = lines.join('\n');
}

fs.writeFileSync(path, code, 'utf8');
console.log('Done');
