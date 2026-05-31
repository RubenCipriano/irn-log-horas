# Plan 010-B — Calendar MVP (cloud port from apps/web)

**Created**: 2026-05-25 (after plan 010-A + plan 011 closed)
**Depends on**: Plan 009 (`getOrgAdapter`), Plan 010-A (`hours.logged_remote` audit + log-hours endpoint)
**Status**: Spec drafted. Foundation work (shared domain package) starts in this session; UI port is a separate, larger slice.

> The OSS `apps/web` calendar is ~1200 LOC of orchestration around the OpenProject API. To make cloud "feel like the same product", port the calendar so it consumes the **universal adapter contract** instead of OpenProject directly. The calendar is the most user-visible part of TimeFlow — until it lands in cloud, cloud is a thin admin shell.

---

## 1. Why this slice exists

Plan 010-A shipped the **point-write**: a developer can log hours against one remote task at a time. The calendar is what makes that workflow scale — month-at-a-glance recommendations driven by the status timeline, AI distribute palette, optimistic updates, sprint ring, the works.

Porting wholesale would duplicate 2000+ LOC of pure-domain logic that already lives in `apps/web/lib/` (status timeline math, recommendations engine, holidays, work schedule). Step one is therefore a **shared package** so the same code runs in web and cloud — anything else is a maintenance bomb.

Step two is **adapter contract extension**: the calendar needs per-task activity history to build timelines. The OpenProject adapter already returns `raw: t` on `listAssignedTasks`, but timeline construction requires `/api/v3/work_packages/:id/activities`. We need an adapter method `listTaskActivities(ctx, taskId)` that returns a normalised activity stream; OpenProject implements it natively, Jira maps to `expand=changelog`, Linear maps to GraphQL `issueHistory`.

Step three is the **calendar UI port** — large.

---

## 2. Scope (split into 3 sub-slices)

### Sub-slice 010-B-α — shared domain package *(this session if time permits)*

In scope:
- New package `@timeflow/domain` under `packages/domain/`
- Copies of (or moves from `apps/web/lib/`) the pure-domain logic:
  - `status-timeline.ts` — segment math, timeline construction, `inferGaps`, `DEFAULT_STATUS_WEIGHTS`, `deriveActiveBounds`, etc.
  - `recommendations.ts` — `calculateSmartRecommendations`
  - `calendar-utils.ts` — month grid math, week boundaries
  - `holidays.ts` — Portuguese holidays
  - `work-schedule.ts` — schedule types
  - `task-filtering.ts` + `sprint-filtering.ts` — UI helpers
- `apps/cloud/package.json` gets `@timeflow/domain`
- `apps/web` stays unchanged this session (its lib/ files become the source of truth; the package is a copy/sync). Apps/web migration is a follow-up cleanup, NOT a blocker.

Out of scope:
- AI prompt/distribute migration (those depend on the cloud-side activity timeline, which needs sub-slice β first)
- GitLab integration (cloud doesn't have a GitLab adapter yet; that's separate)

### Sub-slice 010-B-β — adapter contract extension *(next session)*

In scope:
- New optional method on `IProjectIntegration`: `listTaskActivities(ctx, taskId): Promise<TaskActivity[]>`
- `TaskActivity` normalised shape:
  ```typescript
  type TaskActivity = {
    id: string;
    occurredAt: string;       // ISO
    kind: "status_change" | "comment" | "other";
    statusChange?: { from: string | null; to: string };
    raw?: unknown;
  };
  ```
- OpenProject implementation — port the 3-fallback parser (structured, PT regex, EN regex) from `apps/web/app/api/openproject/verify-token/route.ts`
- Jira implementation — `GET /rest/api/3/issue/{key}?expand=changelog`, map changelog items where `field === "status"`
- Linear implementation — GraphQL `issueHistory` query, filter for status transitions
- Cache: keyed `adapter:{orgId}:activities:{taskId}` with 1h TTL

Out of scope:
- Webhook-driven cache invalidation (deferred — pull-on-demand works for MVP)

### Sub-slice 010-B-γ — calendar UI port *(separate session, largest)*

In scope:
- `apps/cloud/app/calendar/page.tsx` — server-rendered month grid, fetches the user's assigned tasks + activity timelines via the adapter
- Calendar grid + day cell components (port from `apps/web/components/Calendar/`)
- Recommendation engine call site (now reads from `@timeflow/domain`)
- AI distribute palette wired against cloud-side adapter (depends on AI prompt being ported — sub-slice 010-C)
- Optimistic updates against the log-hours endpoint from plan 010-A
- Status timeline strip inside the day modal
- Sprint detection (port from apps/web)

Out of scope (defer to follow-up):
- GitLab activity ribbon (no cloud GitLab adapter)
- Timeline inference settings UI
- Command-palette + keyboard shortcuts (small follow-up)
- AI provider config UI (assumes the org has one set — separate org-level provider config slice)

---

## 3. Prerequisites

- Plan 009 + 010-A landed (done — `getOrgAdapter`, log-hours endpoint, audit pipeline)
- Decision: where do AI provider configs live in cloud? Currently apps/web stores them in localStorage. For cloud, they should be per-user OR per-org with a vault-encrypted credential. **Defer this decision until sub-slice γ** — provider config is its own small slice.

---

## 4. Security checks for this slice

| Check | Where |
|---|---|
| `@timeflow/domain` is pure — zero network/DB imports — so it can run in client or server without leaking | `packages/domain/src/*.ts` — verify no `fetch`/`auth`/`db` imports |
| `listTaskActivities` shares the per-(org, integration) rate-limit bucket — heavy month-loads can't DoS the upstream | adapter implementations all consult `ctx.rateLimiter` |
| Activity cache scoped per-`(orgId, taskId)` — never cross-org reuse | adapter cache wrapper already enforces orgId prefix (plan 009) |
| Calendar route gated by `requireOrgRole(orgId, "developer")` (viewers excluded) — once URL-scoped routing lands, the orgSlug carries this | calendar page |

---

## 5. Acceptance criteria (per sub-slice)

**010-B-α (this session, if time):**
- [ ] `@timeflow/domain` exists with the 7 modules listed above
- [ ] Builds cleanly; `apps/cloud` can `import { calculateSmartRecommendations } from "@timeflow/domain"`
- [ ] Apps/web is NOT modified (zero risk to OSS users this session)

**010-B-β (next session):**
- [ ] `listTaskActivities` on all 3 adapters; OpenProject parses status transitions via the same 3-fallback strategy as apps/web
- [ ] Cache wired with 1h TTL
- [ ] Errors classified via existing `IntegrationErrorState` machinery

**010-B-γ (later session):**
- [ ] `/calendar` page renders the month grid for a connected OpenProject org
- [ ] Day cells show recommendations from `@timeflow/domain` engine
- [ ] Click-to-edit + log-hours flow lands via plan 010-A's endpoint
- [ ] Status timeline strip in modal renders correctly
- [ ] Optimistic updates work (calendar is responsive even on slow networks)

---

## 6. Estimated effort

- α: 2–3h (shared package skeleton + 7 module copies)
- β: 6–8h (adapter extension + 3 implementations + cache + tests)
- γ: 1–2 full sessions (UI port + AI distribute wiring)

**Total: ~3 sessions** (~3 working days at this scope).

---

## 7. Follow-up plans

- **Plan 010-C** — AI distribute via adapter activity timeline. Depends on β.
- **Plan 013** — Apps/web migration to `@timeflow/domain` (cleanup; no behaviour change, just deduplication).
- **Plan 014** — GitLab adapter for cloud (so calendar's GitLab ribbon can land).
