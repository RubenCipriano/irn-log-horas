# TimeFlow

Multi-tenant SaaS for logging work hours against project tracker integrations (OpenProject, Jira, Linear, GitLab) — plus a native PM mode for teams without one.

Two self-contained services: a **.NET 8 backend** that exposes the API + runs background jobs, and a **Next.js SPA** built to static HTML and served by nginx. They talk over CORS — there is no in-front reverse proxy; the SPA is the only thing your users hit and it makes browser-side calls to the backend.

## Repo layout

```
irn-log-horas/
├── backend/                       .NET 8 service
│   ├── README.md
│   ├── LICENSE
│   ├── .env.example
│   ├── docker-compose.yml         standalone: backend + postgres + redis
│   ├── Dockerfile
│   ├── TimeFlow.sln
│   ├── TimeFlow.Api/              minimal-API host + endpoints
│   ├── TimeFlow.Auth/             JWT-in-cookie + Argon2id + TOTP + Redis denylist
│   ├── TimeFlow.Data/             EF Core context, models, migrations
│   ├── TimeFlow.Domain/           pure-C# schedule + holiday resolvers
│   ├── TimeFlow.Cache/            Redis cache-aside with tag invalidation
│   ├── TimeFlow.Rbac/             role × permission matrix + filter
│   ├── TimeFlow.Vault/            AES-256-GCM envelope encryption
│   ├── TimeFlow.Integrations/     OpenProject / Jira / Linear / GitLab adapters
│   ├── TimeFlow.Ai/               multi-provider streaming (Anthropic, OpenAI, Groq, OpenRouter, Ollama)
│   └── TimeFlow.Billing/          feature gates (stub)
├── frontend/                      Next.js 16 SPA (output: 'export')
│   ├── README.md
│   ├── LICENSE
│   ├── .env.example
│   ├── docker-compose.yml         standalone: just the SPA container
│   ├── Dockerfile
│   ├── nginx.conf                 SPA fallback for the catch-all authed shell
│   ├── next.config.ts
│   └── src/
│       ├── app/                   marketing + auth + onboarding + (authed shell)
│       ├── components/            Navbar, Footer, Sidebar, TopBar, AppShellLayout, Hero, Features…
│       ├── hooks/                 useAuth, useTheme, useMyOrgs, useWorklogs, useProjects…
│       └── lib/                   api (axios), types
├── docker-compose.yml             root orchestrator — `include`s both services
├── plans/                         migration plans + history
├── CLAUDE.md
└── README.md
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Backend host | ASP.NET Core 8 minimal APIs | Kestrel goes fast natively; no Node single-thread bottleneck |
| Persistence | PostgreSQL 16 + EF Core 8 (Npgsql) | Code-first migrations; FK-correct schema |
| Background jobs | Hangfire (Postgres-backed) | Built-in `/hangfire` dashboard; durable enqueue + retry |
| Cache | Redis 7 + StackExchange.Redis | Cache-aside with tag indexing + JWT denylist |
| Auth | JWT (HS256) in HTTP-only cookie + Redis revocation denylist; Argon2id passwords; TOTP 2FA | Stateless on the hot path; revocable on logout |
| Crypto | `AesGcm` + HKDF for the vault | Per-blob data keys bound to context |
| AI | `HttpClient` + SSE/NDJSON streaming (no vendor SDKs) | Same wire format every provider |
| Frontend host | Next.js 16 App Router with `output: 'export'` → static HTML served by nginx | Zero per-request render cost |
| Frontend data | TanStack Query 5 + axios with `withCredentials: true` | Cross-origin auth cookie works without a server proxy |
| Cross-origin | CORS with explicit allowed origins | The SPA lives on a different origin from the API |

## Quick start (local dev)

You need Docker + Docker Compose. `git clone` the repo, then either:

```bash
# Bring up backend (postgres + redis + api) AND frontend in one command.
docker compose up -d --build

# OR — work on a single side in isolation.
cd backend  && docker compose up -d --build      # api on http://localhost:5001
cd frontend && docker compose up -d --build      # spa on http://localhost:8080
```

Both sides require these env vars in their respective `.env` files:

| Variable | Where | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | `backend/.env` | Postgres user password |
| `REDIS_PASSWORD` | `backend/.env` | Redis AUTH password |
| `JWT_SECRET` | `backend/.env` | HS256 signing key; `openssl rand -base64 32` |
| `VAULT_KEY` | `backend/.env` | AES-256-GCM master; `openssl rand -base64 32` |
| `CORS_ALLOWED_ORIGINS` | `backend/.env` | Comma-separated SPA origins. Default covers `localhost:3000` + `localhost:8080` |
| `CACHE_NS` | `backend/.env` | Cache key namespace prefix. Default `tf` |
| `NEXT_PUBLIC_API_BASE_URL` | `frontend/.env.local` | Where the SPA points its axios calls. e.g. `http://localhost:5001` |

Health: <http://localhost:5001/api/health> → `{ "ok": true, … }`.
App: <http://localhost:8080/> → marketing landing; sign up → onboarding → calendar.

## Recent

### 2026-05-31 — Cadence-aware billing + member-target invoices

Closed the gap where the Billing card + invoice preview both ignored the new `pay_cadence` column and kept billing every member at the hourly cascade (172h × 14 = 2408 even when the member was on a 1945-flat monthly contract).

- **`InvoiceEndpoints.GatherCandidateLinesAsync` is now cadence-aware.** One resolver drives both project-target and member-target preview/generate. Per worklog owner: `hourly` keeps the existing per-worklog grain + the ancestor rate cascade (`project_members.cost_per_hour` -> nearest-ancestor `project.bill_rate` -> nearest-ancestor `project.default_bill_rate` -> cost as no-markup fallback). `daily` rolls up one line per `(member, project)` = distinct workdays x `daily_rate` and bypasses the per-project bill override. `monthly` rolls up one line per member across projects = `monthly_rate * clamp(loggedHours / expectedHours, 0, 1)`, with `expectedHours` resolved through `ProjectPolicyResolver` when a project filter is set, else org-wide. Pro-ration is clamped so partial windows never over-bill.
- **New endpoints**: `POST /api/orgs/{id}/invoices/preview-for-member` and `POST /api/orgs/{id}/invoices/from-member`. Wizard takes `{ userId, from, to, projectId? (filter), clientId? (tie-break), taxPct, notes }` and persists ONE invoice attributed to either the explicit project filter or the dominant engagement root (so list views still surface the invoice under the right client). Members whose hours span multiple engagements get a `MEMBER_SPANS_CLIENTS` 409 with the candidate id list; an explicit `clientId` that isn't in range gets a `MEMBER_CLIENT_NOT_IN_RANGE` 409. Both endpoints flow through `RequireOrgPermission(Permission.InvoicesWrite)` and the same cache-aside invalidation set as `/generate` (`org:{id}:invoices`, `org:{id}:worklogs`). Preview returns `candidateClients = [{ id, name }]` so the picker shows engagement names instead of id slices.
- **`InvoiceLine` carries `Quantity` (numeric(10,4)) + `QuantityUnit` ('hours'/'days'/'months') + `Cadence` ('hourly'/'daily'/'monthly')** as denormalised fields populated at generation time, so a post-generation cadence flip doesn't rewrite history. Detail + PDF reads carry the same triple through; legacy rows pre-cadence fall back to `(hours, 'hours', 'hourly')`.
- **`InvoiceGenerateView` got a `target` picker** (project | member) at the top. Deep-link `/invoices/new?target=member&userId=...&projectId=...` pre-fills the member form so MemberDetailView can hand off directly. The lines table grows a `Unit` column only when there is at least one non-hours line + tints rollup rows with a `daily`/`monthly` cadence badge. `MEMBER_SPANS_CLIENTS` echo on `/from-member` flips the preview state to surface the radio picker inline.
- **Smoke math (May 2026, rubencipriano13)**: cadence=`monthly`, `monthly_rate=1945.00`, logged 172h (156 worklogs), expected = 4 Mondays/Tuesdays/Wednesdays/Thursdays * 9 + 4 Fridays * 7 (May 1 is the Dia do Trabalhador holiday) = 36+36+36+36+28 = 172h, ratio = 172/172 = 1.0, invoice total = `1945.00 * 1.0 = 1945.00` (was 2408 on the old hourly cascade).

### 2026-05-31 — Multilingual UI (PT/EN/FR) + new home experience (`apps/web`)

The OpenProject hour-logging SPA (`apps/web`) is now fully trilingual and gained a proper landing + dashboard.

- **i18n via next-intl, cookie-driven (no URL segments).** Locale (`pt` default, `en`, `fr`) is a saved preference in the `NEXT_LOCALE` cookie (mirrored to `localStorage`), switched by a `LocaleSwitcher` segmented control. `i18n/request.ts` reads the cookie server-side and streams the active catalog into `NextIntlClientProvider`; the root layout sets `<html lang>` and localizes `<title>`/`<meta>`. `next.config.ts` wraps the config in `createNextIntlPlugin` — the existing CSP/HSTS/X-Frame security headers are preserved (verified at runtime).
- **Every page/component externalized.** ~40 components (Calendar cluster, Kanban, Layout, AI/Command palette + modals, all Settings panels, Setup) had hardcoded Portuguese swapped for `useTranslations()` keys. Message catalogs `messages/{pt,en,fr}.json` — **533 keys, full parity across all three locales** (no stubs). All toasts translated; all `toLocaleDateString("pt-PT", …)` and `MONTHS_PT`/`WEEKDAYS_PT` usage now locale-aware via `lib/i18n/dateLocale.ts` (`bcp47`/`monthNames`/`weekdayNames`).
- **Home restructure.** `/` is now a **Dashboard** overview (hours-this-month vs expected, remaining hours, pending-task count, quick actions, today's GitLab activity); the calendar moved to `/calendar`; the calendar↔kanban toggle and Sidebar gained nav links. A new public **`/welcome`** landing (intro + feature cards + CTA → `/setup`) is where unauthenticated users land instead of being dropped straight into `/setup`.
- **Validation:** `tsc --noEmit` clean, production build green, and a runtime smoke confirmed `pt`/`en`/`fr` SSR correctly (`<html lang>`, headlines, CTAs) on `/welcome` and `/setup`.

### 2026-05-31 — SSRF guard on integration BaseUrls

- New `SafeUpstreamUri` validator in `TimeFlow.Integrations` screens every user-supplied tracker BaseUrl before any HTTP request is built. Blocks loopback (127/8, ::1), link-local incl. cloud metadata (169.254/16, fe80::/10), private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), CGNAT (100.64/10), and unspecified (0.0.0.0, ::). Literal IPs are checked directly; hostnames are resolved and every A/AAAA record is checked. http stays allowed for on-prem installs (host rules apply regardless). Rejections bucket as the generic "couldn't reach upstream" so internal hosts aren't disclosed; the URL is never logged. Residual DNS-rebinding risk noted in source (HttpClient re-resolves at connect time).

### 2026-05-31 — Security & cache-aside blocker sweep

Fixed the 7 BLOCKER findings from the whole-tree dual-review:

- **JWT/Vault secret hardening** (`Program.cs`): `JWT_SECRET` and `VAULT_KEY` are now validated at boot — a weak (<32-byte effective) or known dev-sentinel value aborts startup instead of silently enabling token forgery / cross-tenant auth bypass. Mirrors the vault master-key length check.
- **Cache-aside reads** (`WorklogEndpoints`, `TaskEndpoints`, `MemberEndpoints`): the calendar/worklog list, task list, member list, plus the member `hours-summary` and `allocations` reads now go through `GetOrSetAsync` (2-min TTL; `org:{}:worklogs` / `:tasks` / `:members` / `:projects` tags). Reads exposing `CostPerHour` are keyed by a cost-visibility bucket (`full`/`redacted`) so a redacted-tier caller can never read a full-tier cache entry. Worklog mutations (create/update/bulk/delete) now `InvalidateTagsAsync` on `org:{}:worklogs`.
- **Migration backfill fragility** (`BackfillHierarchyV1` / `DropLegacyHierarchyTables`): auto-client → connection linkage no longer round-trips a truncated display name (which could mismatch on quotes/multibyte chars at the 200-char boundary and abort the `client_id` NOT-NULL promotion). It now correlates via a surrogate `auto_for_connection_id` uuid column, dropped in Phase D.
- **Async hygiene** (dev-only `Phase4SmokeEndpoint`, `Phase8SeedEndpoint`): removed `.Result`/`.Wait()` sync-over-async; added a `CancellationToken` to the seed `SaveChangesAsync`.

### 2026-05-31 — Hierarchy refactor Phase C+D landed

The domain model is now tree-shaped per the [Hierarchy spec](https://github.com/anthropics/claude-code) — one connection equals one client, projects form a 1-N tree via `parent_project_id`, and upstream sub-projects/tasks live as mirror rows inside `native_projects` / `native_tasks` (tuple `(connection_id, upstream_id)`). Squads converted to projects with `type='team'`; squad members became `project_members` with the right `role_on_project`.

Concretely this PR:

- **Phase C — code switch (no schema change):**
  - `WorklogSyncJob` now writes mirror rows into `native_projects` + `native_tasks` (was `upstream_projects` / `upstream_tasks`), and worklogs always pick up `task_id` + `project_id`. Mirror tuple lookup keys the import.
  - `WorklogPushJob` reads the mirror tuple from `NativeTask.ConnectionId + UpstreamTaskId` — `worklogs.upstream_task_id` is no longer touched.
  - `TasksAllEndpoints` / `TasksMeEndpoints` / `IntegrationEndpoints` collapse the old native+upstream merge into one source (`native_tasks` joined to `native_projects`). The `"native" | "upstream"` discriminator is now `ConnectionId IS NULL`.
  - `WorklogEndpoints` drops the `upstreamTaskId` request field — callers send `taskId` whether the task is locally-created or a mirror row; whether to push upstream is decided by the task's mirror tuple.
  - `InvoiceEndpoints` and `MemberEndpoints.HoursSummary` collapse to single gather queries (no more "native + upstream" split). `ReportEndpoints` CSV export resolves the upstream natural ids through the task-side mirror tuple.
  - `ClientEndpoints` removes the `upstream-links` subendpoints (1 connection = 1 client per spec §I8 means the join table is redundant). `SquadEndpoints` removed entirely.

- **Phase D — destructive drops + NOT NULL promotion:**
  - DROP TABLE `upstream_projects`, `upstream_tasks`, `client_upstream_projects`, `squads`, `squad_members`.
  - DROP COLUMN `worklogs.upstream_task_id`.
  - `integration_connections.client_id` promoted to NOT NULL (UNIQUE was already in place from Phase A). A defensive Postgres `DO $$` block asserts no rows are NULL before the ALTER — protects against running Phase D without Phase B.

Model files deleted: `UpstreamProject.cs`, `UpstreamTask.cs`, `ClientUpstreamProject.cs`, `Squad.cs`, `SquadMember.cs`. DbContext entity configs + DbSets removed for the same. Migration: `20260530225751_DropLegacyHierarchyTables`.

Build green, migration applied, schema verified: `\d` shows only `integration_connections`, `native_projects`, `native_tasks` left where five tables used to live; `worklogs.upstream_task_id` is gone; `integration_connections.client_id` is NOT NULL.

## What's wired

### Backend — 11 phases, all green

| Phase | Surface |
|---|---|
| 1 | Foundation, `/api/health` |
| 3 | Auth: signup / login / logout / me + 2FA enroll/verify/disable + change-password |
| 4 | RBAC matrix + AES-256-GCM vault + Redis cache-aside (smoke at `/api/_dev/phase4-smoke` when `DEV_SMOKE=1`) |
| 5 | Orgs + members + project tree (squads merged in as `type='team'`) + policy (schedule/holiday JSON), audit log |
| 6 | Native PM: hierarchical projects + tasks + worklogs + leave/hour types + materialised expected-hours + holidays |
| 7 | Integration adapters: OpenProject / Jira / Linear / GitLab behind one `IProjectIntegration`; vault-encrypted credentials; one connection ↔ one client (spec §I8) |
| 8 | Hangfire-backed sync worker: `POST /sync` enqueues, worker upserts mirror rows into `native_projects` + `native_tasks` via `(connection_id, upstream_id)`, status polled via `/sync-jobs/{id}` |
| 9 | AI streaming (`/api/ai/chat`, `/api/ai/ask`): Anthropic + OpenAI + Groq + OpenRouter + Ollama; SSE with `event: chunk` + `event: close`; per-user rate limit |
| 11 | CSV worklog export at `GET /api/orgs/{id}/worklogs/export.csv` (UTF-8 BOM, RFC 4180 quoting) |

Hangfire dashboard at `/hangfire`, locked to org Owners.

### Frontend — Phase 10 critical-path views

Marketing surface (`/`, `/about`, `/policy`) and auth flow (`/login`, `/signup`, `/onboarding/create-org`) are real static pages. Authed routes go through a catch-all `[...path]` shell that dispatches client-side:

| Route | View | Notes |
|---|---|---|
| `/dashboard` | `DashboardView` | Org pick, week hours, quick links |
| `/calendar` | `CalendarView` | Monthly grid, day cells with logged-vs-expected, click-to-log |
| `/projects` | `ProjectsView` | List + create + archive |
| `/settings` / `/settings/account` | `SettingsAccountView` | Change password, 2FA status |
| `/squads`, `/reports`, `/settings/members`, `/settings/integrations` | `PlaceholderView` | Backend ready; richer UI lands in a follow-up |
| Any other URL | `NotFoundView` | 404 inside the shell |

## Security baseline

- All required prod env vars are validated at boot — `backend/TimeFlow.Api/Program.cs` refuses to start if any are missing.
- Compose files use `${VAR:?…}` so `docker compose up` itself fails fast if `.env` is missing required values.
- Redis requires AUTH; reachable only on the internal `timeflow_internal` network.
- Postgres isn't exposed to the host by default (uncomment the `ports:` block in `backend/docker-compose.yml` for ad-hoc `psql`).
- Rate limits: `/api/auth/*` 30 req/60 s per IP; `/api/account/*` same bucket; `/api/ai/*` 20 req/60 s **per user**.
- Argon2id passwords (`m=64MiB, t=3, p=4`) — PHC string format so the cost can be raised without breaking old hashes.
- 2FA: TOTP via Otp.NET, ±1 step window, 10 single-use backup codes (bcrypt-hashed) on enrol.
- JWT in HTTP-only cookie + Redis revocation by `jti`. Sliding refresh when < 5 min remains.
- All integration credentials encrypted at rest via `TimeFlow.Vault` (AES-256-GCM, HKDF data keys bound to `integration:{connId}` so cross-tenant moves de-authenticate).
- AI provider keys arrive in the request body each call, never persisted, never logged. Frontend keeps them in localStorage.
- Audit log captures every security-sensitive mutation: `org.created/deleted/ownership_transferred`, `member.added/removed/role_changed`, `integration.created/deleted/sync_enqueued`, `worklog.bulk_created`, etc. — actor SET NULL on user delete (GDPR).

## Common operations

```bash
# Generate an EF migration after a model change
cd backend/TimeFlow.Data
dotnet ef migrations add MyChange --output-dir Migrations

# Inspect the Hangfire schema
docker exec timeflow-postgres psql -U timeflow -d timeflow -c "\dt hangfire.*"

# Trigger an integration sync
curl -X POST http://localhost:5001/api/orgs/{orgId}/integrations/{connId}/sync -b cookies.txt

# Pull a CSV of your worklogs for the year
curl "http://localhost:5001/api/orgs/{orgId}/worklogs/export.csv?from=2026-01-01&to=2026-12-31" \
  -b cookies.txt -o worklogs.csv
```

## License

See [LICENSE](LICENSE). Per-service licensing in `backend/LICENSE` and `frontend/LICENSE`.
