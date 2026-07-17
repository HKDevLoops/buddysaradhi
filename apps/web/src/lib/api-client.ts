import { createApiClient } from "@buddysaradhi/shared/zod";

// Browser-side API client points at the embedded BFF (same origin).
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "/api/v1";

// We create a singleton client. 
// In server actions/components we can pass the auth token as an option.
export const gatewayApi = createApiClient(GATEWAY_URL);
