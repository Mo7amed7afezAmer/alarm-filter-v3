"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

// Swagger UI touches `window`; load it in the browser only.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false, loading: () => <p>Loading API documentation…</p> });

/** P3-T03: interactive documentation of /api/v1 (requests use the signed-in session cookie). */
export function ApiDocs() {
  return (
    <div className="rounded-md bg-white">
      <SwaggerUI url="/api/v1/openapi.json" />
    </div>
  );
}
