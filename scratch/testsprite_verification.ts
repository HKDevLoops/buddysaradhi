import http from "node:http";
import fs from "node:fs";

const BASE_URL: string = "http://localhost:3000";

interface HttpResult {
  status: number | undefined;
  data: string;
  error?: string;
}

function httpGet(path: string): Promise<HttpResult> {
  return new Promise((resolve) => {
    http
      .get(`${BASE_URL}${path}`, (res: http.IncomingMessage) => {
        let data: string = "";
        res.on("data", (chunk: unknown) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, data }));
      })
      .on("error", (err: Error) => resolve({ status: 500, data: "", error: err.message }));
  });
}

function httpPost(
  path: string,
  bodyObj: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return new Promise((resolve) => {
    const postData: string = JSON.stringify(bodyObj);
    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 3000,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        ...headers,
      },
    };
    const req: http.ClientRequest = http.request(options, (res: http.IncomingMessage) => {
      let data: string = "";
      res.on("data", (chunk: unknown) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", (err: Error) => resolve({ status: 500, data: "", error: err.message }));
    req.write(postData);
    req.end();
  });
}

interface CheckResult {
  test: string;
  passed: boolean;
  details: string;
}

async function runTests(): Promise<void> {
  const results: CheckResult[] = [];
  console.log("=== TestSprite Verification Test Suite ===");

  // Test 1: Root Redirect
  const t1: HttpResult = await httpGet("/");
  results.push({
    test: "Root Route / Redirect",
    passed: t1.status === 307 || t1.status === 302,
    details: `Status: ${t1.status}`,
  });

  // Test 2: Login Page Render
  const t2: HttpResult = await httpGet("/login");
  results.push({
    test: "Login Page Render (/login)",
    passed: t2.status === 200 && t2.data.includes("Sign In"),
    details: `Status: ${t2.status}, HTML length: ${t2.data.length}`,
  });

  // Test 3: Dashboard Auth Redirect
  const t3: HttpResult = await httpGet("/dashboard");
  results.push({
    test: "Protected Route /dashboard Auth Guard",
    passed: t3.status === 307 || t3.status === 302,
    details: `Status: ${t3.status}`,
  });

  // Test 4: Release Manifest API Endpoint
  const t4: HttpResult = await httpGet("/api/v1/releases/latest");
  let validManifest: boolean = false;
  try {
    const json = JSON.parse(t4.data) as { version?: string; platforms?: { windows?: unknown } };
    validManifest =
      json.version === "1.4.0" &&
      json.platforms !== undefined &&
      json.platforms.windows !== undefined;
  } catch {
    // invalid JSON counts as a failed check below
  }
  results.push({
    test: "API Gateway /api/v1/releases/latest",
    passed: t4.status === 200 && validManifest,
    details: `Status: ${t4.status}, Valid Manifest: ${validManifest}`,
  });

  // Test 5: Unauthenticated Provision Endpoint
  const t5: HttpResult = await httpPost("/api/v1/provision", {});
  results.push({
    test: "API Gateway /api/v1/provision Auth Guard",
    passed: t5.status === 401,
    details: `Status: ${t5.status}`,
  });

  // Test 6: API Proxy Route Handling (/api/v1/students)
  const t6: HttpResult = await httpGet("/api/v1/students");
  results.push({
    test: "API Gateway Proxy /api/v1/students",
    passed: [200, 401, 502, 503].includes(t6.status as number),
    details: `Status: ${t6.status}`,
  });

  console.log(JSON.stringify(results, null, 2));
  fs.writeFileSync("scratch/testsprite_results.json", JSON.stringify(results, null, 2));
}

runTests();
