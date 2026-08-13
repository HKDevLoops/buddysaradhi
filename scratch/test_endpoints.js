const http = require('http');

function checkEndpoint(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, length: data.length });
      });
    }).on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });
  });
}

async function run() {
  const routes = ['/', '/login', '/dashboard', '/signup', '/forgot-password', '/reset-password', '/api/v1/releases/latest'];
  for (const r of routes) {
    const res = await checkEndpoint(r);
    console.log(`Route ${r}: status=${res.status}, len=${res.length || 0}`);
  }
}

run();
