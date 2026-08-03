// diagnose.js
// Run this file using: node diagnose.js
// It checks which local ports are active and whether they respond to HTTP requests.

const http = require('http');
const net = require('net');
const { execSync } = require('child_process');

const PORTS = [3000, 3001, 3100, 3101];

console.log('=== BuddySaradhi Diagnostic Utility ===');
console.log('Checking active ports and HTTP responses...\n');

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = 'closed';

    socket.setTimeout(1000);

    socket.on('connect', () => {
      status = 'open';
      socket.destroy();
    });

    socket.on('error', () => {
      status = 'closed';
    });

    socket.on('timeout', () => {
      status = 'timeout';
      socket.destroy();
    });

    socket.on('close', () => {
      resolve({ port, status });
    });

    socket.connect(port, '127.0.0.1');
  });
}

function testHttpGet(port, path = '/') {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: path,
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      resolve({
        port,
        path,
        success: true,
        statusCode: res.statusCode,
        headers: res.headers
      });
    });

    req.on('error', (err) => {
      resolve({
        port,
        path,
        success: false,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        port,
        path,
        success: false,
        error: 'Timeout'
      });
    });

    req.end();
  });
}

async function run() {
  // 1. Check raw TCP ports
  console.log('1. TCP Port Status (127.0.0.1):');
  for (const port of PORTS) {
    const res = await checkPort(port);
    let processInfo = '';
    
    if (res.status === 'open') {
      try {
        // Query PID on Windows
        const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`).toString().trim();
        const lines = output.split('\n');
        const pids = lines.map(line => {
          const parts = line.trim().split(/\s+/);
          return parts[parts.length - 1];
        }).filter(Boolean);
        
        if (pids.length > 0) {
          const uniquePids = [...new Set(pids)];
          processInfo = ` (PID: ${uniquePids.join(', ')})`;
        }
      } catch (e) {
        // netstat findstr failed or no match
      }
    }
    
    console.log(`   Port ${port}: ${res.status.toUpperCase()}${processInfo}`);
  }
  
  console.log('\n2. HTTP Server Responses:');
  for (const port of PORTS) {
    const tcp = await checkPort(port);
    if (tcp.status === 'open') {
      // Test basic GET /
      const resRoot = await testHttpGet(port, '/');
      if (resRoot.success) {
        console.log(`   http://localhost:${port}/ -> HTTP ${resRoot.statusCode} (Redirect target: ${resRoot.headers.location || 'none'})`);
      } else {
        console.log(`   http://localhost:${port}/ -> Error: ${resRoot.error}`);
      }

      // Test GET /landing
      const resLanding = await testHttpGet(port, '/landing');
      if (resLanding.success) {
        console.log(`   http://localhost:${port}/landing -> HTTP ${resLanding.statusCode} (Redirect target: ${resLanding.headers.location || 'none'})`);
      } else {
        console.log(`   http://localhost:${port}/landing -> Error: ${resLanding.error}`);
      }
    }
  }

  console.log('\n======================================');
  console.log('Please copy and paste the output above to let us troubleshoot the exact issue.');
}

run();
