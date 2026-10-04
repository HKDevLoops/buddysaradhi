import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface LibsqlClient {
  execute: (sql: string) => Promise<{ rows: unknown[] }>;
}

interface LibsqlModule {
  createClient: (config: { url: string; authToken: string }) => LibsqlClient;
}

const { createClient } = require("@libsql/client") as LibsqlModule;

async function testConnection(): Promise<void> {
  const url: string = "https://buddysaradhi-shared-harish2222.aws-ap-south-1.turso.io";
  const token: string =
    "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODU3MDA5MjEsImlkIjoiMDE5Zjc0MDItMWMwMS03NjUxLWEzNjQtY2VjYWQ1OWY3MGViIiwia2lkIjoiQXBxMERoSVM3dzlvOTJPNnhBUGFpaVVqYjJnVGFSRWphX3NOWkhCX1ZWWSIsInJpZCI6ImFjMTE5YjkyLTVlODgtNGRjYi04ZGY0LTE4ZjI1NWVjZWMxOSJ9.kkh4zYx236KCc8_FUaPU6olAkuzIUoXenQ8Y6ObYaH41OvfcJEgsmVMQY4KtMyYACvG4GKvZuti6ELEnYoElBA";

  console.log("Connecting to Turso Cloud:", url);
  const client: LibsqlClient = createClient({ url, authToken: token });

  const res: { rows: unknown[] } = await client.execute("SELECT 1 as num");
  console.log("Query result:", res.rows);
}

testConnection().catch(console.error);
