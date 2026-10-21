import fs from "node:fs";
import path from "node:path";

const HERE: string = import.meta.dirname;

function walkDir(dir: string, callback: (filePath: string) => void): void {
  fs.readdirSync(dir).forEach((f: string) => {
    const dirPath: string = path.join(dir, f);
    const isDirectory: boolean = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

function refactorActions(): void {
  const actionsDir: string = path.join(HERE, "apps/web/src/server/actions");
  walkDir(actionsDir, (filePath: string) => {
    if (!filePath.endsWith(".ts")) return;
    let content: string = fs.readFileSync(filePath, "utf8");

    // Remove tenantId / passedTenantId from signature
    content = content.replace(/passedTenantId:\s*string,\s*/g, "");
    content = content.replace(/tenantId:\s*string,\s*/g, "");

    // Sometimes it's the only argument, so no comma
    content = content.replace(/passedTenantId:\s*string/g, "");
    content = content.replace(/tenantId:\s*string/g, "");

    // Some actions have MOCK_TENANT_ID inside them
    content = content.replace(/const MOCK_TENANT_ID = "00000000-0000-0000-0000-000000000000";\n/g, "");
    content = content.replace(/const tenantId = MOCK_TENANT_ID;\n/g, "");
    // In dashboard actions, it calls queries with tenantId
    content = content.replace(/getDashboardKPIs\(tenantId, /g, "getDashboardKPIs(");
    content = content.replace(/getAttendanceHeatmap\(tenantId, /g, "getAttendanceHeatmap(");
    content = content.replace(/getPaymentHeatmap\(tenantId, /g, "getPaymentHeatmap(");
    content = content.replace(/getActivityFeed\(tenantId, /g, "getActivityFeed(");
    content = content.replace(/getDueToday\(tenantId\)/g, "getDueToday()");

    fs.writeFileSync(filePath, content);
  });
}

function refactorQueries(): void {
  const queriesDir: string = path.join(HERE, "apps/web/src/server/queries");
  walkDir(queriesDir, (filePath: string) => {
    if (!filePath.endsWith(".ts")) return;
    let content: string = fs.readFileSync(filePath, "utf8");

    // Remove tenantId from query signature
    content = content.replace(/passedTenantId:\s*string,\s*/g, "");
    content = content.replace(/tenantId:\s*string,\s*/g, "");

    // Only argument
    content = content.replace(/passedTenantId:\s*string/g, "");
    content = content.replace(/tenantId:\s*string/g, "");

    fs.writeFileSync(filePath, content);
  });
}

function refactorComponents(): void {
  const componentsDir: string = path.join(HERE, "apps/web/src/components");
  walkDir(componentsDir, (filePath: string) => {
    if (!filePath.endsWith(".tsx")) return;
    let content: string = fs.readFileSync(filePath, "utf8");

    // Remove definition
    content = content.replace(/const MOCK_TENANT_ID = "00000000-0000-0000-0000-000000000000";\n/g, "");

    // Remove from query keys: ['name', MOCK_TENANT_ID, ...] -> ['name', ...]
    content = content.replace(/MOCK_TENANT_ID,\s*/g, "");
    content = content.replace(/MOCK_TENANT_ID/g, "");

    fs.writeFileSync(filePath, content);
  });
}

refactorActions();
refactorQueries();
refactorComponents();
console.log("Refactoring complete!");
