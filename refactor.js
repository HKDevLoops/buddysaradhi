const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

function refactorActions() {
  const actionsDir = path.join(__dirname, 'apps/web/src/server/actions');
  walkDir(actionsDir, (filePath) => {
    if (!filePath.endsWith('.ts')) return;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove tenantId / passedTenantId from signature
    content = content.replace(/passedTenantId:\s*string,\s*/g, '');
    content = content.replace(/tenantId:\s*string,\s*/g, '');
    
    // Sometimes it's the only argument, so no comma
    content = content.replace(/passedTenantId:\s*string/g, '');
    content = content.replace(/tenantId:\s*string/g, '');

    // Some actions have MOCK_TENANT_ID inside them
    content = content.replace(/const MOCK_TENANT_ID = "00000000-0000-0000-0000-000000000000";\n/g, '');
    content = content.replace(/const tenantId = MOCK_TENANT_ID;\n/g, '');
    // In dashboard actions, it calls queries with tenantId
    content = content.replace(/getDashboardKPIs\(tenantId, /g, 'getDashboardKPIs(');
    content = content.replace(/getAttendanceHeatmap\(tenantId, /g, 'getAttendanceHeatmap(');
    content = content.replace(/getPaymentHeatmap\(tenantId, /g, 'getPaymentHeatmap(');
    content = content.replace(/getActivityFeed\(tenantId, /g, 'getActivityFeed(');
    content = content.replace(/getDueToday\(tenantId\)/g, 'getDueToday()');

    fs.writeFileSync(filePath, content);
  });
}

function refactorQueries() {
  const queriesDir = path.join(__dirname, 'apps/web/src/server/queries');
  walkDir(queriesDir, (filePath) => {
    if (!filePath.endsWith('.ts')) return;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove tenantId from query signature
    content = content.replace(/passedTenantId:\s*string,\s*/g, '');
    content = content.replace(/tenantId:\s*string,\s*/g, '');
    
    // Only argument
    content = content.replace(/passedTenantId:\s*string/g, '');
    content = content.replace(/tenantId:\s*string/g, '');

    fs.writeFileSync(filePath, content);
  });
}

function refactorComponents() {
  const componentsDir = path.join(__dirname, 'apps/web/src/components');
  walkDir(componentsDir, (filePath) => {
    if (!filePath.endsWith('.tsx')) return;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove definition
    content = content.replace(/const MOCK_TENANT_ID = "00000000-0000-0000-0000-000000000000";\n/g, '');
    
    // Remove from query keys: ['name', MOCK_TENANT_ID, ...] -> ['name', ...]
    content = content.replace(/MOCK_TENANT_ID,\s*/g, '');
    content = content.replace(/MOCK_TENANT_ID/g, '');
    
    fs.writeFileSync(filePath, content);
  });
}

refactorActions();
refactorQueries();
refactorComponents();
console.log('Refactoring complete!');
