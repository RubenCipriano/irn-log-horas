import { AppShell } from "./shell";

// Catch-all for the authenticated SPA portion.
//
// In `output: 'export'` mode, dynamic routes need `generateStaticParams`.
// We return a SINGLE placeholder entry so Next.js emits ONE html file
// (`out/index.html`-style) for this route family. nginx's SPA fallback
// then serves that file for EVERY unknown URL — `/dashboard`,
// `/orgs/foo/calendar`, `/settings/members`, etc. — and the client-side
// `AppShell` reads `window.location.pathname` to decide what to render.
//
// Why optional catch-all `[[...path]]` and not required `[...path]`:
// the optional form also generates a hit for the BARE route, so
// `/` would conflict with the static landing page. We avoid that by
// placing this inside the `(app)` route group which has no URL segment
// but excludes the root `/` path from competing pre-renders.

export const dynamicParams = false;

export function generateStaticParams() {
  // One placeholder entry. Without this Next refuses to build a dynamic
  // route in export mode. The actual URL is read client-side from
  // window.location.
  return [{ path: ["__shell__"] }];
}

export default function AppCatchAllPage() {
  return <AppShell />;
}
