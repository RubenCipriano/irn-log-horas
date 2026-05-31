import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // `output: 'export'` produces a fully static `out/` folder. No Node
  // runtime needed at serve time — nginx-alpine ships the files. Public
  // pages (`/`, `/about`, `/policy`) are real HTML; authed routes use a
  // catch-all that hydrates into the SPA shell at runtime.
  //
  // The export is disabled in dev so `next dev` can still run hot reload
  // and the dev-time tooling. Production builds (Docker, CI) export.
  output: isDev ? undefined : "export",

  // Image optimization needs a runtime — disable for static export so
  // `<Image>` falls back to plain `<img>` semantics.
  images: { unoptimized: true },

  // The frontend lives at a different origin than the backend now (no
  // nginx proxy). All API calls go through the configured axios client
  // (`src/lib/api.ts`) which reads `NEXT_PUBLIC_API_BASE_URL`. No Next
  // rewrites needed — the browser makes cross-origin requests directly,
  // backend's CORS allows them.
};

export default nextConfig;
