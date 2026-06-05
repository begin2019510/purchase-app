const fs = require('fs');
const h = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/index.html', 'utf8');

// Check if todo modals exist
console.log('todoModalOverlay:', h.includes('id="todoModalOverlay"'));
console.log('todoDetailOverlay:', h.includes('id="todoDetailOverlay"'));

// Check where modals are positioned
const modalIdx = h.indexOf('id="todoModalOverlay"');
const detailIdx = h.indexOf('id="todoDetailOverlay"');
console.log('todoModal at char:', modalIdx);
console.log('todoDetail at char:', detailIdx);

// Check what's around the modal
if (modalIdx > 0) {
  const before = h.substring(Math.max(0, modalIdx - 100), modalIdx);
  console.log('Before todoModal:', before.replace(/\n/g, ' ').trim());
}

// Check if modal-overlay class is defined in CSS
const css = fs.readFileSync('D:/OpenClawWorkspace/purchase-app/theme.css', 'utf8');
console.log('modal-overlay in CSS:', css.includes('.modal-overlay'));
console.log('modal-overlay.active in CSS:', css.includes('.modal-overlay.active'));

// Check modal HTML structure
const modalStart = h.indexOf('id="todoModalOverlay"');
const modalEnd = h.indexOf('</div>', h.indexOf('saveTodo()', modalStart));
if (modalStart > 0) {
  console.log('\nTodo modal HTML (first 500 chars):');
  console.log(h.substring(modalStart - 50, Math.min(h.length, modalStart + 500)));
}
