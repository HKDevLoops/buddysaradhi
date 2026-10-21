// k6 load profile for the ledger service readiness probe.
// Run (k6 executes JavaScript, so bundle first): esbuild load-test.ts --external:k6/* --format=esm --outfile=load-test.bundle.js && k6 run load-test.bundle.js
declare module "k6/http" {
  export interface K6Response {
    status: number;
  }
  const http: {
    get: (url: string) => K6Response;
  };
  export default http;
}

declare module "k6" {
  export function check<T>(val: T, checks: Record<string, (v: T) => boolean>): boolean;
  export function sleep(seconds: number): void;
}

import http from "k6/http";
import { check, sleep } from "k6";

interface LoadStage {
  duration: string;
  target: number;
}

interface LoadOptions {
  stages: LoadStage[];
  thresholds: Record<string, string[]>;
}

export const options: LoadOptions = {
  stages: [
    { duration: "30s", target: 20 }, // Ramp up to 20 users
    { duration: "1m", target: 20 }, // Stay at 20 users
    { duration: "30s", target: 0 }, // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% of requests should be below 500ms
  },
};

export default function (): void {
  const url: string = "http://localhost:3001/ready";

  const res = http.get(url);

  check(res, {
    "is status 200": (r) => r.status === 200,
  });

  sleep(1);
}
