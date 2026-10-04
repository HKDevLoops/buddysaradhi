import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

// __dirname is provided by the runner (bun) for this entrypoint.
declare const __dirname: string;

interface Service {
  name: string;
  cwd: string;
  command: string;
  port: number;
}

const services: Service[] = [
  { name: 'web', cwd: 'apps/web', command: 'pnpm run start', port: 3000 },
  { name: 'gateway', cwd: 'apps/gateway', command: 'pnpm run dev', port: 3001 },
  { name: 'ledger-svc', cwd: 'apps/services/ledger-svc', command: 'pnpm run dev', port: 3031 },
  { name: 'attendance-svc', cwd: 'apps/services/attendance-svc', command: 'pnpm run dev', port: 3033 },
  { name: 'auth-svc', cwd: 'apps/services/auth-svc', command: 'pnpm run dev', port: 3037 },
];

console.log('Starting all services for E2E tests...');

const processes: ChildProcess[] = services.map((svc: Service) => {
  console.log(`Starting ${svc.name} on port ${svc.port}...`);
  const child: ChildProcess = spawn(svc.command.split(' ')[0] as string, svc.command.split(' ').slice(1), {
    cwd: path.resolve(__dirname, '..', svc.cwd),
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: String(svc.port),
    },
  });

  child.on('error', (err: Error) => {
    console.error(`Failed to start ${svc.name}:`, err);
  });

  return child;
});

process.on('SIGINT', () => {
  console.log('Killing all services...');
  processes.forEach((p: ChildProcess) => p.kill('SIGINT'));
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('Killing all services...');
  processes.forEach((p: ChildProcess) => p.kill('SIGTERM'));
  process.exit();
});

// Wait forever
setInterval(() => {}, 1000);
