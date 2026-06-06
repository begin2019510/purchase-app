const https = require('https');
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

(async () => {
  try {
    const todo = await fetch('https://121212121.top/js/todo.js?v=3.3.0');
    console.log('LIVE todo.js length:', todo.length);
    console.log('First 200 chars:', todo.substring(0, 200));
    console.log('Has IIFE:', todo.includes('(function(){'));
    console.log('Has function renderTodo:', todo.includes('function renderTodo'));
    console.log('Has function loadTodos:', todo.includes('function loadTodos'));
    
    // Check encoding
    const buf = Buffer.from(todo);
    console.log('\nFirst 10 bytes:', Array.from(buf.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    // Check if there's a BOM
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) console.log('Has UTF-8 BOM');
    if (buf[0] === 0xFF && buf[1] === 0xFE) console.log('Has UTF-16LE BOM');
  } catch(e) {
    console.log('Error:', e.message);
  }
})();
