# TimeFlow — Frontend (Next.js SPA)

Next.js 16 (App Router) built as a static export. Static marketing pages (`/`, `/about`, `/policy`), static auth shells (`/login`, `/signup`), and a catch-all SPA shell that handles every authenticated route client-side.

> **Migration status — Phase 2 / 11**: marketing pages live, login/signup shells wired (backend route lands Phase 3), authed SPA shell returns "not yet built" for every route except `/dashboard` (which shows a health-check stub).

## Stack

| Concern | Tech |
|---|---|
| Framework | Next.js 16 (App Router), `output: 'export'` |
| Runtime | React 19 |
| Routing | Next.js router + a catch-all SPA shell for unknown paths |
| Data fetching | TanStack Query 5 + axios |
| Styling | Tailwind CSS 4 |
| Build output | Pure static `out/` folder served by nginx-alpine |

## How the routing works

Next.js's static export needs to know every URL at build time. Strategy:

- **Real static pages**: `/`, `/about`, `/policy`, `/login`, `/signup` each have their own `app/<route>/page.tsx`. The build emits `<route>.html`.
- **Catch-all SPA shell**: `app/(app)/[...path]/page.tsx` declares a required catch-all with `generateStaticParams: () => [{ path: ["__shell__"] }]`. The build emits `out/__shell__.html`.
- **nginx fallback** (`nginx.conf`): `try_files $uri $uri.html $uri/ /__shell__.html;` — known files resolve directly; anything else (e.g. `/orgs/foo/dashboard`) serves the shell.
- **Client-side dispatch**: the shell reads `window.location.pathname` after mount and renders the right authed view. Phase 3+ progressively register real route handlers in `app/(app)/[...path]/shell.tsx`'s `dispatch()` switch.

The trade-off: every authed page is the same HTML on first paint ("Loading…"), then hydrates. Marketing pages are full HTML with content. This is the right balance because marketing is what unauthenticated traffic (bots, scrapers, social previews) hits, and the authed UI is one round-trip away anyway.

## Project layout

```
frontend/
├── app/
│   ├── layout.tsx                ← root layout (server component)
│   ├── providers.tsx             ← TanStack Query provider (client island)
│   ├── page.tsx                  ← / (static landing)
│   ├── about/page.tsx            ← /about (static)
│   ├── policy/page.tsx           ← /policy (static)
│   ├── login/page.tsx            ← /login (client-component shell)
│   ├── signup/page.tsx           ← /signup (client-component shell)
│   ├── (app)/[...path]/
│   │   ├── page.tsx              ← catch-all stub w/ generateStaticParams
│   │   └── shell.tsx             ← client-side router for authed views
│   ├── _marketing/chrome.tsx     ← shared nav + footer for static pages
│   └── globals.css               ← Tailwind import + tokens
├── public/                       ← favicon, robots.txt, etc.
├── nginx.conf                    ← inner nginx SPA-fallback config
├── Dockerfile                    ← multi-stage: node:20-alpine build → nginx:alpine runtime
├── docker-compose.yml            ← standalone: brings up just this container
├── next.config.ts                ← output: 'export' + dev API proxy
├── .env.example                  ← optional dev overrides
└── package.json
```

## Dev commands

```bash
npm install
npm run dev      # http://localhost:3000 with /api/* proxied to :5001
npm run build    # produces ./out/ for the Dockerfile
```

`npm run dev` runs in NON-export mode so hot reload, server actions, and the `/api/*` rewrite (see `next.config.ts`) all work locally. Production builds (CI, Docker) set `NODE_ENV=production` which flips on `output: 'export'`.

## Standalone via Docker

```bash
cd frontend
docker compose up -d --build

# SPA reachable at:
curl http://localhost:8080/
```

The standalone compose exposes port `8080:80` so it doesn't clash with the root proxy on `3700`. When running via the root `docker-compose.yml`, the proxy reaches this container internally as `frontend:80` and serves it on `3700`.

## License

See [LICENSE](LICENSE).
