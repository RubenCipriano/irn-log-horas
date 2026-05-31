# Plan 012 — Apps/web → cloud migration prompt + localStorage import

**Created**: 2026-05-25
**Depends on**: Plan 009 (org-context primitive), Plan 010-A (log-hours via adapter)
**Status**: Spec drafted. Not started.

> Apps/web users have all their state in localStorage (token, AI provider config, GitLab config, work schedule, task pins, status weights, theme). When they try cloud for the first time, none of that comes with them — they re-configure from scratch and the experience feels worse than the OSS app. Plan 012 closes that gap with a one-click "Bring my settings to cloud" flow.

---

## 1. Why this slice exists

- Cloud onboarding currently asks for an OpenProject URL + token. Existing web users already supplied this. Asking again is friction; auto-importing builds trust.
- Status-weight overrides, work schedule custom hours, and theme preferences are personal calibrations users put effort into. Recreating them is annoying.
- AI provider keys are the most sensitive — but also the most painful to set up. Web users stored them client-side; cloud should offer to receive them with the same trust model (we encrypt server-side via the vault; user opts in explicitly).

---

## 2. Scope

### In scope

- A new top-of-page banner on apps/cloud `/dashboard` that detects "I think you're a web user" (heuristic: presence of `?from=web` query OR a cookie set by the web app) and offers a one-click migrate.
- A new page `/onboarding/import` that asks the user to paste a single JSON blob containing their web-side state. Web app exposes this as a "Download my data" button under settings.
- A `POST /api/account/import` endpoint that takes the JSON, validates per-field, and applies what it can:
  - OpenProject token → if no integration is connected for the current org, create one (Admin role required, otherwise prompt to ask the admin)
  - AI provider config → store in `user_preferences` (new column `ai_provider_config` — opaque JSON, encrypted via the vault since it contains an API key)
  - Work schedule overrides → `user_preferences` (new column `work_schedule_json`)
  - Status weight overrides → `user_preferences` (new column `status_weights_json`)
  - Task pinning + meetings task id + active sprint → deferred (they're tied to a specific OpenProject instance; we'd need the integration connected first, then we could map them)
  - Theme + week_start → already in user_preferences
- Audit: `account.imported` action with diff = which buckets were applied
- Idempotency: re-importing replaces the previous value per-field; the user can re-export from web and re-import to cloud and the result is the same as one import

### Explicitly out of scope

- Automated round-trip "keep them in sync" (this is a one-shot migration; ongoing sync is too much complexity for an OSS→SaaS transition)
- Migrating logged hours (cloud reads them from OpenProject directly via the adapter — nothing to import; the source of truth is the same)
- Email-the-link flow (no email infra yet)

---

## 3. Prerequisites

- Plan 009 (`requireCurrentOrgRole`) — gates the import endpoint
- A `user_preferences` schema extension for the new opaque columns (single migration adds 3 nullable JSON columns)
- The web app needs a "Download my data" button — small UI add to `apps/web/components/Layout/SettingsDrawer.tsx`. Spec only references it; the build is part of this plan.

---

## 4. Security checks

| Check | Where |
|---|---|
| Endpoint gated by `requireCurrentOrgRole("viewer")` — every authenticated user can import their OWN profile | `/api/account/import/route.ts` |
| The JSON blob is bounded (50 KB max) — protects against memory-DoS via crafted payloads | endpoint validation |
| AI provider config + OpenProject token are encrypted via `@timeflow/vault` before persisting | endpoint applier |
| Adapter validation runs on the OpenProject token before saving — same path as `/api/orgs/[id]/integrations` | endpoint shared with that route's validator |
| Per-field validation: shape, length, allowed enum values. Unknown fields are silently dropped (forward-compat) | endpoint |
| Audit captures *which buckets were imported*, never the values themselves | audit diff |
| Rate-limited: 5/hour per user (same shape as `account_export` bucket) | endpoint |

---

## 5. Implementation phases

### 5.1 Schema migration *(1h)*

Add to `packages/db/src/schema/auth.ts` (the `userPreferences` table):
- `aiProviderConfig text` — nullable, encrypted JSON
- `workScheduleJson text` — nullable, plain JSON (no PII)
- `statusWeightsJson text` — nullable, plain JSON

Drizzle migration generated + checked in.

### 5.2 Web "Download my data" button *(0.5h)*

`apps/web/components/Layout/SettingsDrawer.tsx` gets a button at the bottom that calls a small JS function:
```typescript
function exportToJson() {
  const blob = {
    version: 1,
    openproject: {
      url: localStorage.getItem("openproject_url"),
      token: localStorage.getItem("openproject_token"),
    },
    ai: JSON.parse(localStorage.getItem("ai_provider_config_v1") ?? "null"),
    workSchedule: JSON.parse(localStorage.getItem("work_schedule") ?? "null"),
    statusWeights: JSON.parse(localStorage.getItem("status_weights_v1") ?? "null"),
    theme: localStorage.getItem("theme_v1"),
    weekStart: null, // web doesn't store this yet
    meetingsTaskId: localStorage.getItem("meetings_task_id"),
    activeSprint: localStorage.getItem("active_sprint"),
  };
  // Download as a .json file
}
```

User downloads, opens cloud, pastes into the import page.

### 5.3 Cloud import endpoint *(2h)*

`/api/account/import/route.ts` — `POST` with the JSON body. Validates each bucket individually (one bad field doesn't reject the whole payload — we apply what we can and report which buckets succeeded). Errors collected, returned with a per-bucket status.

### 5.4 Cloud import UI *(2h)*

`/onboarding/import/page.tsx` (or a banner card on `/dashboard` that links to it) — single textarea to paste the JSON + "Import" button. Shows per-bucket success/skip after submission.

### 5.5 Detection banner on `/dashboard` *(0.5h)*

Trigger conditions (heuristic — not load-bearing):
- Cookie `from_web=1` (set by the web app if a user clicks "Try cloud")
- OR the user is freshly created (< 1 day) AND has zero `user_preferences` set
- → show a soft banner above the dashboard cards: "Coming from the OSS web app? Import your settings in one click."

Dismissible via cookie `migration_banner_dismissed=1`.

### 5.6 Audit + docs *(0.5h)*

- New audit action `account.imported` in [audit.ts](packages/db/src/schema/audit.ts)
- README changelog
- CLAUDE.md note on the new opaque preference columns

---

## 6. Acceptance criteria

- [ ] `userPreferences` has `aiProviderConfig`, `workScheduleJson`, `statusWeightsJson` columns
- [ ] Web "Download my data" button produces a versioned JSON blob
- [ ] `/onboarding/import` accepts paste + applies per-bucket
- [ ] `/api/account/import` validates, encrypts the AI key + OpenProject token before persisting
- [ ] Audit row written; `account.imported` action defined
- [ ] Dashboard banner shows for new users with the heuristic
- [ ] All four error states (bad JSON, oversize, invalid field, upstream validation fail) surfaced clearly

---

## 7. Estimated effort

~6.5h / single focused session.

---

## 8. Follow-up

- Plan 013 — apps/web migration to `@timeflow/domain` (deduplication; once 010-B-α lands)
- The "ongoing sync" question is left open. Most likely answer: never — the OSS app stays the OSS app, cloud is a separate product. One-shot migration is the bridge.
