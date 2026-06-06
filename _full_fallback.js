const fs = require('fs');
let a = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/js/app.js', 'utf8');

// Remove old fallback
a = a.replace(/\/\/ Fallback: if todo module[\s\S]*?(?=\n\/\/ app\.js)/, '');

// Add comprehensive fallback for ALL todo functions
const fallback = `// Fallback: stubs for todo module functions (overwritten when todomodule.js loads)
(function(){
  var _todoStub = function(){};
  var _todoAsyncStub = async function(){};
  var fns = [
    'renderTodo','renderTodoCalendar','loadTodos','openTodoModal','closeTodoModal',
    'saveTodo','openTodoDetail','closeTodoDetail','completeTodo','deleteTodo',
    'toggleTodoSubtask','switchTodoView','switchTodoFilter','addSubtask',
    'removeSubtask','updateSubtaskText','todoCalPrev','todoCalNext',
    'selectTodoCalDay','onTodoFab','formatDueDate','getDueClass'
  ];
  fns.forEach(function(fn){
    if(typeof window[fn] === 'undefined'){
      window[fn] = fn.startsWith('load') || fn === 'saveTodo' || fn === 'completeTodo' || fn === 'deleteTodo' ? _todoAsyncStub : _todoStub;
    }
  });
})();
`;

a = fallback + a;
fs.writeFileSync('D:/OpenClawWorkspace/purchase-app/js/app.js', a, 'utf8');
console.log('Added comprehensive fallback stubs');

// Verify
const verify = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/js/app.js', 'utf8');
console.log('Has addSubtask fallback:', verify.includes("'addSubtask'"));
console.log('Has openTodoModal fallback:', verify.includes("'openTodoModal'"));
