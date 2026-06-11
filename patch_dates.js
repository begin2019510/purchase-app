const fs = require('fs');

// Patch todomodule.js
let td = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/js/todomodule.js', 'utf8');

// Fix 1: saveTodo - convert datetime-local to ISO string
td = td.replace(
  "      dueDate: document.getElementById('todoDueDate').value || null,",
  "      dueDate: (function(){ var v = document.getElementById('todoDueDate').value; return v ? new Date(v).toISOString() : null; })(),"
);

// Fix 2: AI response handler - use local time
td = td.replace(
  "          if (data.dueDate) { document.getElementById('todoDueDate').value = data.dueDate.slice(0,16); }",
  "          if (data.dueDate) { var _d = new Date(data.dueDate + 'T00:00:00'); document.getElementById('todoDueDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0')+'T00:00'; }"
);

fs.writeFileSync('D:/OpenClawWorkspace/purchase-app/js/todomodule.js', td, 'utf8');
console.log('todomodule.js patched');

// Patch project.js
let pj = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/js/project.js', 'utf8');

// Fix 3: openProjectModal - use local time for display
pj = pj.replace(
  "  document.getElementById('projectDueDate').value = p && p.dueDate ? new Date(p.dueDate).toISOString().slice(0,16) : '';",
  "  if (p && p.dueDate) { var d = new Date(p.dueDate); document.getElementById('projectDueDate').value = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } else { document.getElementById('projectDueDate').value = ''; }"
);

// Fix 4: saveProject - convert datetime-local to ISO string
pj = pj.replace(
  "    dueDate: document.getElementById('projectDueDate').value || null,",
  "    dueDate: (function(){ var v = document.getElementById('projectDueDate').value; return v ? new Date(v).toISOString() : null; })(),"
);

fs.writeFileSync('D:/OpenClawWorkspace/purchase-app/js/project.js', pj, 'utf8');
console.log('project.js patched');