import { spawn } from 'child_process';
import path from 'path';

const services = [
  { name: 'web', cwd: 'apps/web', command: 'pnpm run start', port: 3000 },
  { name: 'gateway', cwd: 'apps/gateway', command: 'pnpm run dev', port: 3001 },
  { name: 'ledger-svc', cwd: 'apps/services/ledger-svc', command: 'pnpm run dev', port: 3031 },
  { name: 'attendance-svc', cwd: 'apps/services/attendance-svc', command: 'pnpm run dev', port: 3033 },
  { name: 'auth-svc', cwd: 'apps/services/auth-svc', command: 'pnpm run dev', port: 3037 },
];

console.log('Starting all services for E2E tests...');

const processes = services.map(svc => {
  console.log(`Starting ${svc.name} on port ${svc.port}...`);
  const child = spawn(svc.command.split(' ')[0], svc.command.split(' ').slice(1), {
    cwd: path.resolve(__dirname, '..', svc.cwd),
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: String(svc.port),
    },
  });
  
  child.on('error', err => {
    console.error(`Failed to start ${svc.name}:`, err);
  });
  
  return child;
});

process.on('SIGINT', () => {
  console.log('Killing all services...');
  processes.forEach(p => p.kill('SIGINT'));
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Killing all services...');
  processes.forEach(p => p.kill('SIGTERM'));
  process.exit();
});

// Wait forever
setInterval(() => {}, 1000);
