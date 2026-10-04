import http from "node:http";

interface EndpointResult {
  status: number | undefined;
  headers?: http.IncomingHttpHeaders;
  length?: number;
  error?: string;
}

function checkEndpoint(path: string): Promise<EndpointResult> {
  return new Promise((resolve) => {
    http
      .get(`http://localhost:3000${path}`, (res: http.IncomingMessage) => {
        let data: string = "";
        res.on("data", (chunk: unknown) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, length: data.length });
        });
      })
      .on("error", (err: Error) => {
        resolve({ status: 500, error: err.message });
      });
  });
}

async function run(): Promise<void> {
  const routes: string[] = [
    "/",
    "/login",
    "/dashboard",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/api/v1/releases/latest",
  ];
  for (const r of routes) {
    const res: EndpointResult = await checkEndpoint(r);
    console.log(`Route ${r}: status=${res.status}, len=${res.length || 0}`);
  }
}

run();
