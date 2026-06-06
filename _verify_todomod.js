const https = require('https');
const req = https.get('https://121212121.top/js/todomodule.js', res => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Length:', data.length);
    console.log('Has loadTodos:', data.includes('loadTodos'));
    console.log('Has renderTodo:', data.includes('renderTodo'));
    console.log('First 100:', data.substring(0, 100));
  });
});
req.on('error', e => console.log('Error:', e.message));
