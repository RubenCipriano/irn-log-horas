import type { NextConfig } from "next";

// Security headers. Kept conservative on CSP: we set frame-ancestors (clickjacking)
// and the cheap hardening headers, but deliberately avoid a restrictive script-src
// that would break Next.js inline hydration scripts. All external calls (OpenProject,
// GitLab, AI providers) go through same-origin /api routes, so the browser never
// needs cross-origin connect permissions.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
  // HSTS — safe because the IRN deployment is served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
