import { route } from "@/lib/api";
import { buildOpenApi } from "@/lib/openapi";

// Built from the route modules on first request.
export const dynamic = "force-dynamic";

// P3-T03: the OpenAPI 3.1 document, ADMIN only.
export const GET = route({ minRole: "ADMIN" }, async () => buildOpenApi());
