# CLAUDE.md — TimeFlow

Working in this repo? Read this once, then defer to the more specific docs as you go:

| If you're working on... | Read |
|---|---|
| Backend (C# .NET 8) | THIS file (you're here) |
| Frontend (React / Next.js 16) | [frontend/CLAUDE.md](frontend/CLAUDE.md) → [frontend/AGENTS.md](frontend/AGENTS.md) |
| The active overhaul (hierarchical projects) | [plans/016-hierarchical-projects-and-project-membership.md](plans/016-hierarchical-projects-and-project-membership.md) |
| Specialist agents | [.claude/agents/](.claude/agents/) — roster below |
| Slash commands | [.claude/skills/](.claude/skills/) — roster below |

## What TimeFlow is

Multi-tenant SaaS for logging work hours against project-tracker integrations (OpenProject, Jira, Linear, GitLab) or a native PM. Calendar with org-aware schedules + holidays, AI-assisted hour distribution, role-gated dashboards, weekly approval, client billing.

Always start by reading [README.md](README.md) for the user-facing changelog.

## Stack

- **Backend** (`backend/`): C# .NET 8 + ASP.NET Core minimal APIs + EF Core 8 + Npgsql + PostgreSQL 16 + Redis + Hangfire
- **Frontend** (`frontend/`): React 19 + Next.js 16 + TypeScript + Tailwind 4. Separate SPA — has its own CLAUDE.md.
- **Project layout** (don't invent new packages; extend existing ones):
  ```
  backend/
    TimeFlow.Api/           minimal-API host + endpoints + Hangfire jobs
    TimeFlow.Auth/          JWT cookie auth, password hashing, 2FA TOTP
    TimeFlow.Billing/       feature flags + invoice-status enums
    TimeFlow.Cache/         Redis-backed ICacheStore + cache-aside helper
    TimeFlow.Data/          EF Core schema + DbContext + migrations + backfills
    TimeFlow.Domain/        pure-domain helpers (timeline math, schedule, holidays)
    TimeFlow.Integrations/  adapter contract + per-provider adapters
    TimeFlow.Rbac/          Permission enum + matrix + RequireOrgPermission filter
    TimeFlow.Vault/         AES-256-GCM envelope (HKDF-derived data keys)
    TimeFlow.Ai/            AI provider contract + provider adapters
  frontend/                 React 19 + Next.js 16 SPA
  plans/                    Historical + active implementation plans
  ```

## Load-bearing contracts (DO NOT BREAK)

### Auth gate — every org-scoped endpoint

Chain `.RequireOrgPermission(Permission.X)` from `TimeFlow.Rbac`. The org id comes from the **route, NEVER from session lookup**. Filter source: [backend/TimeFlow.Rbac/RequireOrgPermissionFilter.cs](backend/TimeFlow.Rbac/RequireOrgPermissionFilter.cs).

Inside the handler:
```csharp
var (orgId, role) = http.RequireOrgContext();   // resolved by the filter
```

404 (not a member) vs 403 (member, role too low) is intentional — don't leak tenant existence to attackers probing for org ids. Picking org from session was the legacy `getCurrentMembership` pattern; it gave multi-org users the wrong role for cross-org requests and is forbidden.

### Cache-aside — every cached read + every mutation

Reads:
```csharp
var rows = await cache.GetOrSetAsync(
    key: $"org:{orgId:N}:projects:active",
    ttl: TimeSpan.FromMinutes(2),
    tags: new[] { $"org:{orgId:N}:projects" },
    loader: async ct2 => await db.NativeProjects.Where(p => p.OrgId == orgId && !p.Archived).ToListAsync(ct2),
    ct: ct);
```

Mutations:
```csharp
await db.SaveChangesAsync(ct);
await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:projects" }, ct);
await audit.LogAsync(new AuditEntry { Action = "project.created", ... });
```

**Tag namespace** (drift = stale reads):

| Tag | Touched by |
|---|---|
| `org:{orgId:N}:projects` | NativeProjects CRUD |
| `org:{orgId:N}:tasks` | NativeTasks CRUD |
| `org:{orgId:N}:worklogs` | Worklog CRUD |
| `org:{orgId:N}:members` | OrgMembership CRUD |
| `org:{orgId:N}:integrations` | IntegrationConnection CRUD |
| `org:{orgId:N}:int:{connectionId:N}` | per-connection upstream caches |
| `org:{orgId:N}:weeks` | WorklogWeek approvals |
| `user:{userId:N}:...` | per-user reads (prefs, sessions) |

**No new server-side DB read without cache-aside. No mutation without invalidation.** The `caching-reviewer` agent gates this on every PR.

### GDPR cascade — every FK to `user.id`

- `OnDelete(DeleteBehavior.SetNull)` — shared/org-owned rows (`audit_log.actor_id`, `native_projects.created_by`, `org_integrations.created_by`, etc.). History stays; identity anonymised.
- `OnDelete(DeleteBehavior.Cascade)` — user-private rows (`sessions`, `two_factor`, `notifications`, `user_preferences`, `org_memberships`).

`DELETE /api/account/delete` refuses with 409 if the user is sole Owner of any org. Refused attempts are audited.

`GET /api/account/export` (Art. 20) returns profile + sessions + orgs + memberships + worklogs + audit entries. **Excludes server-only secrets** (password hashes, 2FA secrets, vault-encrypted credentials).

### Secrets

- Integration credentials encrypted at rest via `IVaultService.Encrypt/Decrypt` with associated-data string `integration:{connectionId:N}`. Plaintext only inside the request that needs it; **never logged**.
- Integration HTTP failures bucketed by status class (401/403, 5xx, generic). Upstream response bodies **never echoed to the client**.
- Password rotation always passes `revokeOtherSessions: true`. There's no toggle — rotate-without-revoke is the unsafe default. Failed changes audited + rate-limited.
- 2FA (TOTP) at `/security/2fa`.

## Schema + migrations

- Entities under `backend/TimeFlow.Data/Models/<Entity>.cs` (one file per entity).
- All `OnModelCreating` config in [backend/TimeFlow.Data/TimeFlowDbContext.cs](backend/TimeFlow.Data/TimeFlowDbContext.cs) — entity-by-entity `b.Entity<X>(e => { ... })` blocks.
- Migrations: `backend/TimeFlow.Data/Migrations/<timestamp>_PascalCaseDescription.cs`. Generate via `dotnet ef migrations add ...`.
- **Snake_case** column + table names (Npgsql convention).
- Index naming: `ix_<table>_<columns>[_unique]`. Constraint naming: `pk_<table>`, `fk_<table>_<ref>`.
- **Adding NOT NULL on a populated column** is a multi-step ceremony: ADD nullable → backfill PR → SET NOT NULL in a follow-up migration. Never one-shot.

**Backfills** are migrations whose `Up` calls `migrationBuilder.Sql("...")`. Idempotent (`ON CONFLICT DO NOTHING`, `WHERE col IS NULL`). Complex backfill helpers go in `backend/TimeFlow.Data/Backfills/`.

## Background jobs (Hangfire)

`BackgroundJob.Enqueue<TJob>(j => j.RunAsync(...))` for fire-and-forget work. Args MUST be primitive (Guids, strings, ints) — Hangfire serialises them. The DI scope creates a fresh DbContext + HttpClient per execution (no cross-request state leaks).

Cooperative cancellation at every loop boundary:
- Check `IJobCancellationToken.ShutdownToken` for process shutdown
- Re-read the job's `cancel_requested` from the DB (the user's cancel POST writes there)

Reference: [backend/TimeFlow.Api/Services/WorklogSyncJob.cs](backend/TimeFlow.Api/Services/WorklogSyncJob.cs).

## Active overhaul: hierarchical projects (plan 016)

[plans/016-hierarchical-projects-and-project-membership.md](plans/016-hierarchical-projects-and-project-membership.md) is the active multi-PR migration. Highlights:

- Projects become a 1-N tree (`parent_project_id` self-FK, unbounded depth)
- `IntegrationConnection.ClientId` becomes NOT NULL + UNIQUE (1:1 with client)
- Squads + UpstreamProjects + UpstreamTasks + ClientUpstreamProjects → dropped, absorbed into `projects` + `tasks`
- Project-level membership with nearest-ancestor-wins inheritance (I1/I2)
- Soft-archive when worklogs exist (I5); cross-client re-parent rejected (I6); cycle prevention (I7)
- `bill_rate` cascade (I3); rate snapshot at invoice time (I4)

Phase A (schema additions) + part of Phase B (backfill) already in flight. WorklogSyncJob reads from the new unified `native_tasks` mirror columns.

## Commands

From the repo root:

| Command | What |
|---|---|
| `docker compose up -d` | Bring up the full stack (Postgres + Redis + backend + frontend) |
| `docker compose -f backend/docker-compose.yml up -d --build backend` | Rebuild + restart just the backend |
| `dotnet build backend/TimeFlow.sln --nologo` | Build the C# solution |
| `dotnet test backend/TimeFlow.sln --nologo` | Run backend tests |
| `dotnet ef migrations add <Name> --project backend/TimeFlow.Data --startup-project backend/TimeFlow.Api` | New migration |
| `dotnet ef database update --project backend/TimeFlow.Data --startup-project backend/TimeFlow.Api` | Apply migrations |
| `docker exec -it timeflow-postgres psql -U timeflow -d timeflow` | Interactive DB shell |
| `docker logs -f timeflow-backend` | Tail backend logs |

Required env vars (see `backend/.env.example`): `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `VAULT_KEY`, `CORS_ALLOWED_ORIGINS`, `CACHE_NS`. Backend `instrumentation` refuses to start if any are missing or hold a known dev sentinel.

## Agents

Specialist agents live in [.claude/agents/](.claude/agents/) — invoke via the `Agent` tool. Use them; don't try to do specialist work in the main thread.

| Agent | When |
|---|---|
| `product-owner` | requirement clarification, scope decisions, PT copy |
| `backend-architect` | design backend changes before coding |
| `frontend-architect` | design SPA changes before coding |
| `migration-author` | EF Core schema migration |
| `backfill-author` | idempotent data backfill |
| `endpoint-author` | minimal-API endpoint implementation |
| `frontend-author` | React/Next.js component implementation |
| `integrations-specialist` | adapters + WorklogSyncJob |
| `calendar-specialist` | calendar grid, day-form, AI distribute |
| `billing-specialist` | invoice generation, rate cascade, snapshots |
| `rbac-security-reviewer` | authz + secrets review (read-only gate) |
| `caching-reviewer` | cache-aside contract review (read-only gate) |
| `db-migration-reviewer` | migration safety review (read-only gate) |
| `code-reviewer` | general C#/TS quality review (read-only gate) |
| `qa-engineer` | integration tests + smoke scripts |
| `pr-orchestrator` | drives a plan section to a working PR (delegates) |

## Slash commands

In [.claude/skills/](.claude/skills/). Type `/<name>` to invoke.

| Skill | What |
|---|---|
| `/start-pr <num>` | Kick off a plan section (e.g. `/start-pr 016.3`) |
| `/migration <name>` | Scaffold a new EF migration |
| `/backfill <desc>` | Scaffold a data backfill |
| `/verify-sync` | End-to-end OpenProject sync smoke |
| `/check-cache-contract` | Cache-aside review on current diff |
| `/check-authz` | Authz + security review on current diff |
| `/dual-review` | All reviewers in parallel |
| `/rebuild-backend` | Rebuild + restart backend container |
| `/smoke [step]` | Run plan 016 verification scenarios |
| `/inspect-db [sql]` | Postgres query against the local DB |

## Language

- **UI strings in Portuguese**. Match the existing terse style (`Sincronizar`, `Apagar`, `Confirmar`). No emojis unless the existing screen already has them.
- **Code identifiers + comments + commit messages + internal docs in English**.
- No mixed-language constants (`ACCEPT_BUTTON = "Aceitar"` is worse than inline).

## Comments

Only for the WHY (a hidden constraint, a subtle invariant, a workaround for a specific bug). Don't describe WHAT the code does — naming carries that. Don't reference the current task or PR number ("added for ticket #123") — that belongs in the PR description and rots in the codebase.

## Known gotchas

- **Three status-parse fallbacks** in OpenProject's activity reader (structured details / PT regex / EN regex). All three exist because real installs hit different paths. Don't simplify.
- **Iterative scale-to-fill loop** in `frontend/src/lib/recommendations.ts` — guarantees daily totals match `expectedHours - alreadyRegistered` exactly. Don't modify.
- **Connection-wide upsert cache** in `WorklogSyncJob`. The unique index is `(connection_id, upstream_task_id)` — connection-wide, NOT per-project. Per-project caches crash on cross-project moves with `duplicate key value` errors.
- **`activeFrom` / `activeUntil`** on tasks — keep populating from the timeline; `lib/task-filtering.ts` reads them.
- **AI keys never persist server-side**. Provider config travels per-request in the `/api/ai/distribute` body and is discarded after the LLM call. Don't add request logging.
- **No LLM SDKs**. Gemini / Groq / Ollama / OpenRouter / OpenAI-compat all hit via `HttpClient`. Don't add vendor deps.
- **clear-time-entries scoping**: filter by current user via `/users/me`, else fetches other users' entries and 403s upstream.

## After changes

After any session that ships code, update [README.md](README.md) with a changelog entry describing the session's work.
