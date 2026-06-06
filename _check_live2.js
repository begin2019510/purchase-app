const https = require('https');
const options = { hostname: '121212121.top', path: '/js/todo.js', timeout: 10000 };
const req = https.get(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Length:', data.length);
    console.log('Has IIFE:', data.includes('(function(){'));
    console.log('Has renderTodo def:', data.includes('function renderTodo'));
    console.log('Has loadTodos def:', data.includes('function loadTodos'));
    console.log('First 150:', data.substring(0, 150));
  });
});
req.on('error', e => console.log('Error:', e.message));
req.on('timeout', () => { req.destroy(); console.log('Timeout'); });
