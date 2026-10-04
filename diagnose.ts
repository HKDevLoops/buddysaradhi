// diagnose.ts
// Run this file using: node diagnose.ts
// It checks which local ports are active and whether they respond to HTTP requests.

import http from "node:http";
import net from "node:net";
import { execSync } from "node:child_process";

const PORTS: number[] = [3000, 3001, 3100, 3101];

console.log("=== BuddySaradhi Diagnostic Utility ===");
console.log("Checking active ports and HTTP responses...\n");

type PortStatus = "open" | "closed" | "timeout";

interface PortCheck {
  port: number;
  status: PortStatus;
}

interface HttpSuccess {
  port: number;
  path: string;
  success: true;
  statusCode: number | undefined;
  headers: http.IncomingHttpHeaders;
}

interface HttpFailure {
  port: number;
  path: string;
  success: false;
  error: string;
}

type HttpResult = HttpSuccess | HttpFailure;

function checkPort(port: number): Promise<PortCheck> {
  return new Promise((resolve) => {
    const socket: net.Socket = new net.Socket();
    let status: PortStatus = "closed";

    socket.setTimeout(1000);

    socket.on("connect", () => {
      status = "open";
      socket.destroy();
    });

    socket.on("error", () => {
      status = "closed";
    });

    socket.on("timeout", () => {
      status = "timeout";
      socket.destroy();
    });

    socket.on("close", () => {
      resolve({ port, status });
    });

    socket.connect(port, "127.0.0.1");
  });
}

function testHttpGet(port: number, path: string = "/"): Promise<HttpResult> {
  return new Promise((resolve) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: port,
      path: path,
      method: "GET",
      timeout: 2000,
    };

    const req: http.ClientRequest = http.request(options, (res: http.IncomingMessage) => {
      resolve({
        port,
        path,
        success: true,
        statusCode: res.statusCode,
        headers: res.headers,
      });
    });

    req.on("error", (err: Error) => {
      resolve({
        port,
        path,
        success: false,
        error: err.message,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        port,
        path,
        success: false,
        error: "Timeout",
      });
    });

    req.end();
  });
}

async function run(): Promise<void> {
  // 1. Check raw TCP ports
  console.log("1. TCP Port Status (127.0.0.1):");
  for (const port of PORTS) {
    const res: PortCheck = await checkPort(port);
    let processInfo: string = "";

    if (res.status === "open") {
      try {
        // Query PID on Windows
        const output: string = execSync(
          `netstat -ano | findstr LISTENING | findstr :${port}`,
        ).toString().trim();
        const lines: string[] = output.split("\n");
        const pids: string[] = lines
          .map((line: string) => {
            const parts: string[] = line.trim().split(/\s+/);
            return parts[parts.length - 1] as string;
          })
          .filter(Boolean);

        if (pids.length > 0) {
          const uniquePids: string[] = [...new Set(pids)];
          processInfo = ` (PID: ${uniquePids.join(", ")})`;
        }
      } catch {
        // netstat findstr failed or no match
      }
    }

    console.log(`   Port ${port}: ${res.status.toUpperCase()}${processInfo}`);
  }

  console.log("\n2. HTTP Server Responses:");
  for (const port of PORTS) {
    const tcp: PortCheck = await checkPort(port);
    if (tcp.status === "open") {
      // Test basic GET /
      const resRoot: HttpResult = await testHttpGet(port, "/");
      if (resRoot.success) {
        console.log(
          `   http://localhost:${port}/ -> HTTP ${resRoot.statusCode} (Redirect target: ${resRoot.headers.location || "none"})`,
        );
      } else {
        console.log(`   http://localhost:${port}/ -> Error: ${resRoot.error}`);
      }

      // Test GET /landing
      const resLanding: HttpResult = await testHttpGet(port, "/landing");
      if (resLanding.success) {
        console.log(
          `   http://localhost:${port}/landing -> HTTP ${resLanding.statusCode} (Redirect target: ${resLanding.headers.location || "none"})`,
        );
      } else {
        console.log(`   http://localhost:${port}/landing -> Error: ${resLanding.error}`);
      }
    }
  }

  console.log("\n======================================");
  console.log("Please copy and paste the output above to let us troubleshoot the exact issue.");
}

run();
