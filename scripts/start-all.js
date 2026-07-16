import { spawn } from 'child_process';
import path from 'path';

const services = [
  { name: 'web', cwd: 'apps/web', command: 'bun run start' },
  { name: 'gateway', cwd: 'apps/gateway', command: 'bun run dev' },
  { name: 'ledger-svc', cwd: 'apps/services/ledger-svc', command: 'bun run dev' },
  { name: 'attendance-svc', cwd: 'apps/services/attendance-svc', command: 'bun run dev' },
  { name: 'auth-svc', cwd: 'apps/services/auth-svc', command: 'bun run dev' },
];

console.log('Starting all services for E2E tests...');

const processes = services.map(svc => {
  console.log(`Starting ${svc.name}...`);
  const child = spawn(svc.command.split(' ')[0], svc.command.split(' ').slice(1), {
    cwd: path.resolve(__dirname, '..', svc.cwd),
    stdio: 'inherit',
    shell: true,
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
