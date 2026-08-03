import fs from 'fs';
import path from 'path';

const services = [
  'ledger-svc',
  'student-svc',
  'attendance-svc',
  'sync-svc',
  'report-svc',
  'notification-svc',
  'auth-svc'
];

const appsDir = path.join(process.cwd(), 'apps');
const servicesDir = path.join(appsDir, 'services');

if (!fs.existsSync(servicesDir)) {
  fs.mkdirSync(servicesDir, { recursive: true });
}

for (const svc of services) {
  const svcPath = path.join(servicesDir, svc);
  const srcPath = path.join(svcPath, 'src');
  
  if (!fs.existsSync(srcPath)) {
    fs.mkdirSync(srcPath, { recursive: true });
  }

  // Write package.json
  fs.writeFileSync(path.join(svcPath, 'package.json'), JSON.stringify({
    name: `@buddysaradhi/${svc}`,
    version: "1.0.0",
    private: true,
    main: "src/index.ts",
    scripts: {
      "dev": "bun run --watch src/index.ts",
      "build": "bun build src/index.ts --target=bun",
      "start": "bun run src/index.ts"
    },
    dependencies: {
      "elysia": "^1.0.0",
      "@buddysaradhi/shared": "workspace:*",
      "@buddysaradhi/core": "workspace:*"
    },
    devDependencies: {
      "typescript": "^5.0.0",
      "@types/bun": "latest"
    }
  }, null, 2));

  // Write tsconfig.json
  fs.writeFileSync(path.join(svcPath, 'tsconfig.json'), JSON.stringify({
    "compilerOptions": {
      "target": "ESNext",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "outDir": "./dist"
    },
    "include": ["src"]
  }, null, 2));

  // Write src/index.ts
  fs.writeFileSync(path.join(srcPath, 'index.ts'), `import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "${svc} is running!")
  .listen(process.env.PORT || Math.floor(Math.random() * (4000 - 3000 + 1) + 3000));

console.log(
  \`🦊 ${svc} is running at \${app.server?.hostname}:\${app.server?.port}\`
);
`);

}

// Create gateway
const gatewayPath = path.join(appsDir, 'gateway');
const gatewaySrcPath = path.join(gatewayPath, 'src');
if (!fs.existsSync(gatewaySrcPath)) {
  fs.mkdirSync(gatewaySrcPath, { recursive: true });
}

fs.writeFileSync(path.join(gatewayPath, 'package.json'), JSON.stringify({
  name: `@buddysaradhi/gateway`,
  version: "1.0.0",
  private: true,
  main: "src/index.ts",
  scripts: {
    "dev": "bun run --watch src/index.ts",
    "build": "bun build src/index.ts --target=bun",
    "start": "bun run src/index.ts"
  },
  dependencies: {
    "elysia": "^1.0.0",
    "@buddysaradhi/shared": "workspace:*"
  },
  devDependencies: {
    "typescript": "^5.0.0",
    "@types/bun": "latest"
  }
}, null, 2));

fs.writeFileSync(path.join(gatewayPath, 'tsconfig.json'), JSON.stringify({
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}, null, 2));

fs.writeFileSync(path.join(gatewaySrcPath, 'index.ts'), `import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => "API Gateway is running!")
  .listen(3000);

console.log(
  \`🦊 API Gateway is running at \${app.server?.hostname}:\${app.server?.port}\`
);
`);

console.log("Scaffolding complete.");
