import { createClient } from "@libsql/client";
import { resolve } from "path";

export function getTursoClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "Missing TURSO_DATABASE_URL environment variable."
    );
  }

  // A local file: URL is allowed to run without an auth token. Resolve relative
  // paths against the process cwd so `file:../../prisma/dev.db` works.
  let resolvedUrl = url;
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    if (!filePath.startsWith("///") && !filePath.startsWith("/") && !/^[a-zA-Z]:/.test(filePath)) {
      resolvedUrl = `file:${resolve(filePath)}`;
    }
  }
  const resolvedToken = authToken || "";

  return createClient({
    url: resolvedUrl,
    authToken: resolvedToken,
  });
}
