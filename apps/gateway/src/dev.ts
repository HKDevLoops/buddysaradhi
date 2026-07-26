import app from "./index";
import { log } from "./lib/logger";

const port = Number(process.env.PORT) || 3001;
log.info("gateway_boot", `TutorOS API Gateway listening on :${port}`, { port });
Bun.serve({ port, fetch: app.fetch });
