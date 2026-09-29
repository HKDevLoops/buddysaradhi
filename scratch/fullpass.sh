#!/usr/bin/env bash
# Full CI-equivalent verification pass (mirrors .github/workflows/lint.yml + test.yml)
set -u
cd "$(dirname "$0")/.." || exit 1

echo "########## 1. ROOT UNIT TESTS (pnpm test:unit) ##########"
pnpm run test:unit 2>&1
echo "EXIT_unit=$?"

echo "########## 2. INTEGRATION TESTS (pnpm test:integration) ##########"
pnpm run test:integration 2>&1
echo "EXIT_integration=$?"

echo "########## 3. WEB VITEST SUITE ##########"
pnpm --filter web exec vitest run 2>&1
echo "EXIT_webvitest=$?"

echo "########## 4. WEB BUILD ##########"
pnpm --filter web build 2>&1
echo "EXIT_webbuild=$?"

echo "########## 5. PRODUCT-PAGE BUILD ##########"
pnpm --filter product-page build 2>&1
echo "EXIT_ppbuild=$?"

echo "########## 6. VERSION CHECK ##########"
pnpm run version:check 2>&1
echo "EXIT_version=$?"

echo "########## 7. PLAYWRIGHT INSTALL (chromium) ##########"
pnpm --filter web exec playwright install chromium 2>&1
echo "EXIT_pwinstall=$?"

echo "########## 8. START LOCAL SERVER ##########"
if [ -d apps/web/.next ]; then
  (cd apps/web && pnpm exec next start -p 3300 > /tmp/webserver.log 2>&1 &)
else
  (cd apps/web && pnpm exec next dev -p 3300 > /tmp/webserver.log 2>&1 &)
fi
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3300/; then echo "server up after ${i}s"; break; fi
  sleep 1
done

echo "########## 9. PLAYWRIGHT E2E (incl. a11y spec) ##########"
PLAYWRIGHT_TEST_BASE_URL=http://localhost:3300 pnpm --filter web exec playwright test 2>&1
echo "EXIT_e2e=$?"

echo "########## 10. STOP LOCAL SERVER ##########"
for pid in $(netstat -ano 2>/dev/null | grep ':3300' | grep -i listening | awk '{print $NF}' | sort -u); do
  taskkill //PID "$pid" //F 2>/dev/null || true
done

echo "########## 11. DONE ##########"
