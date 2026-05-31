# Plan 018 — Billing tiers + GitLab integration + AI distribute

**Created**: 2026-05-25
**Depends on**: Plans 009 (org context), 010-B (calendar), 015 (org policy), 016 (calendar parity audit)
**Status**: In progress. Tier infra + AI ship this session; GitLab adapter is queued for the very next session.

> Three slices that together turn cloud from "fancy calendar" into "feature-rich SaaS we can sell". The wiring exists in the OSS web app (AI providers in `apps/web/lib/ai/`, GitLab client in `apps/web/lib/gitlab/`); the cloud port adds multi-tenant config + per-feature billing gates so anything can be moved to a paid tier without retrofitting paywalls later.

---

## 1. Why this slice exists

User feedback, paraphrased:
> *"Improve the recommendation algorithm or just remove it completely WITH GitLab + AI integrations too. Give wiggle room so those features will be paid later down the line, as well as the calendar."*

Two things to unpack:

1. **The recommendation algorithm should be augmented (not replaced) by GitLab activity + AI distribute.** GitLab gives the engine real activity signal ("I pushed 4 commits to task #32195 yesterday"); AI is the top-level UX ("describe what you did → distribute hours"). The existing engine still ranks the picker in the "+ Adicionar tarefa" flow.
2. **Build paywall hooks NOW, even if everything is free today.** Retrofitting feature gates after launch is painful; building them upfront with sensible defaults (everyone on `team` tier until billing is real) is cheap.

---

## 2. Scope

### 018-α — Billing tier infrastructure (this session)

**`@timeflow/billing` package:**
- `OrgPlan` enum: `"free" | "team" | "scale"`.
- `Feature` enum covering everything gateable: `calendar`, `multi_integration`, `ai_distribute`, `gitlab_integration`, `approval_workflow`, `client_billing_reports`, `audit_log`, `webhooks`, `sso`, `viewer_seats`, `native_pm_unlimited_projects`, etc.
- `FEATURE_TIERS: Record<Feature, OrgPlan>` — minimum tier required for each feature.
- `hasFeature(plan, feature): boolean` pure helper.

**Schema:**
- `organisations.plan` column, default `"team"` so existing orgs keep full access.
- `organisations.planExpiresAt` (nullable timestamp) — for trial windows / downgrade scheduling.
- `org_subscriptions` table — placeholder for Stripe metadata (subscriptionId, status, currentPeriodEnd). Empty rows until Stripe lands; the column-shape lets us wire Stripe later without a migration.

**Cloud helpers** (`apps/cloud/lib/billing.ts`):
- `readOrgPlan(orgId): Promise<OrgPlan>` — defaults to `"team"` when null (existing orgs).
- `requireFeature(orgId, feature): Promise<void>` — throws `ForbiddenError` with a typed `featureRequired: { feature, minPlan }` payload the UI converts to an upgrade prompt.
- `orgHasFeature(orgId, feature): Promise<boolean>` — quiet variant for UI gating (hide-instead-of-error).

**`<FeatureGate>` UI primitive:**
- Server component that wraps gated UI; renders an inline "upgrade to Team" card when the org's plan lacks the feature.
- Client variant `<FeatureGateClient>` for "open this in a modal" interactions (the AI button uses this).

**New audit action `billing.plan_changed`** — captures plan transitions when Stripe wires up.

### 018-β — AI distribute (this session)

**Per-user AI provider config:**
- `user_preferences.aiProviderConfig` (text/JSON, vault-encrypted) — the AI provider + API key. Per-user because the API key is sensitive and personal; an org admin can't read it.
- Provider config shape mirrors `apps/web/types.ts AIProviderConfig` (existing surface).

**Cloud-side `@timeflow/ai` package** — port from `apps/web/lib/ai/`:
- `provider.ts` — common interface.
- `anthropic.ts`, `gemini.ts`, `groq.ts`, `openrouter.ts`, `openai-compat.ts`, `ollama.ts` — provider adapters from the OSS app, unchanged. All use plain `fetch`.
- `factory.ts` — dispatcher.
- `matcher.ts` — Fuse.js fuzzy match.
- `prompt.ts` — Portuguese system prompt + JSON validator.
- `distribute.ts` — orchestrator (no GitLab baseline yet; that lands with 018-γ).

**Cloud endpoint** `POST /api/ai/distribute`:
- Auth-gated by `requireOrgRole(orgId, "developer")`.
- Feature-gated by `requireFeature(orgId, "ai_distribute")`.
- Provider config decrypted from the user's `aiProviderConfig`. Never logged.
- Per-(org, user) rate limit via the existing `adapter_call` bucket.
- Streams the response (the OSS web app streams; we match).

**Settings page `/settings/ai`** — Admin/Dev configures their provider:
- Provider dropdown (Anthropic / Gemini / Groq / OpenRouter / Ollama / OpenAI-compat).
- API key input (password-masked).
- Test button — calls a smoke "hello world" prompt to validate.
- Save → encrypts via `@timeflow/vault` and writes to `user_preferences.aiProviderConfig`.

**Calendar wiring:**
- "🪄 IA" button in the day modal opens a textarea: "Descreve o que fizeste hoje…".
- POSTs to `/api/ai/distribute` with `{ description, dateRange, tasks, ... }`.
- Modal shows the proposed distribution as a preview; user confirms → bulk POST to log-hours.
- Behind `<FeatureGateClient feature="ai_distribute">` — if the org plan doesn't include AI, the button opens an upgrade prompt instead.

### 018-γ — GitLab adapter (NEXT session)

**Adapter port from `apps/web/lib/gitlab/`:**
- `packages/integrations/src/adapters/gitlab.ts` — new adapter implementing the universal contract.
- Auth: Personal Access Token (PAT) with `api` scope.
- `validateCredentials({ baseUrl, token })` → `/api/v4/user`.
- `listProjects(ctx)` → `/api/v4/projects?membership=true`.
- `listAssignedTasks(ctx)` → `/api/v4/issues?assignee_username=...&state=opened` (GitLab issues mapped to ITask).
- `listTaskActivities(ctx, taskId)` → `/api/v4/projects/:id/issues/:iid/resource_state_events` (status timeline).
- `listWorklogs` → not supported (GitLab doesn't have time-tracking entries; left undefined).
- New optional `listUserActivity(ctx, opts)` method — returns commits + MRs for the date range. Used as AI prompt context.

**Cloud calendar GitLab ribbon:**
- DayCell grows a small icon indicator when there's GitLab activity for that day.
- Day modal lists the day's commits/MRs with extracted task ids (the OSS `extractTaskIds(text)` regex).

**RBAC gating** (already in `@timeflow/rbac`):
- `gitlab.see_own` (Developer + Tech Lead): see own commits/MRs.
- `gitlab.see_squad` (Tech Lead): see squad commits.
- `gitlab.see_org` (Owner + Admin): org-wide.
- `gitlab.configure` (Owner + Admin): connect/disconnect.

**Feature-gated** by `gitlab_integration` requiring `team` plan.

---

## 3. Tier matrix (initial proposal)

| Feature | free | team | scale |
|---|:---:|:---:|:---:|
| Calendar (basic) | ✅ | ✅ | ✅ |
| Log hours to ONE integration | ✅ | ✅ | ✅ |
| Multi-integration (OpenProject + Jira + Linear simultaneously) | ❌ | ✅ | ✅ |
| GitLab integration | ❌ | ✅ | ✅ |
| AI distribute (Anthropic / Gemini / etc.) | ❌ | ✅ | ✅ |
| Approval workflow | ❌ | ✅ | ✅ |
| Client billing reports | ❌ | ✅ | ✅ |
| Audit log read (90 days) | ❌ | ✅ | ✅ |
| Audit log read (1 year) | ❌ | ❌ | ✅ |
| Webhooks | ❌ | ❌ | ✅ |
| SSO (SAML/OIDC) | ❌ | ❌ | ✅ |
| Public REST API | ❌ | ❌ | ✅ |
| Viewer seats | unlimited | unlimited | unlimited |

Default for existing orgs (no Stripe wired): **`team`** — everyone keeps everything. When Stripe lands, the default drops to `free` for new signups and existing orgs keep their grandfathered plan.

---

## 4. Security checks

| Check | Where |
|---|---|
| `aiProviderConfig` encrypted via `@timeflow/vault` before persisting; decrypted only in-process at endpoint call | `lib/ai-config.ts` |
| `/api/ai/distribute` rate-limited per-user (bucket `adapter_call` or new `ai_distribute`) | endpoint |
| Provider API keys never logged. Audit captures `ai.distributed` with the action's task ids + hours, never the prompt content (could leak project names + the API key if echoed verbatim from a misbehaving provider) | endpoint |
| Feature gates double-checked server-side — `<FeatureGateClient>` is a UX hint, the API endpoint independently calls `requireFeature` | every gated endpoint |
| `org.plan` mutations only happen via Stripe webhook (or admin override audit action) — no client-visible "change plan" PATCH | future Stripe slice |

---

## 5. Implementation order (this session)

1. Schema: `organisations.plan` + `org_subscriptions` + migration. New audit action.
2. `@timeflow/billing` package: types + feature map + helpers.
3. `apps/cloud/lib/billing.ts` cloud helpers.
4. `<FeatureGate>` component.
5. AI config schema column + vault wiring.
6. Port `@timeflow/ai` (provider/factory/anthropic minimum).
7. `/api/ai/distribute` endpoint.
8. `/settings/ai` UI for provider config.
9. Wire the calendar IA button → distribute modal.

---

## 6. Acceptance criteria (this session)

- [ ] `org.plan` column exists with default `team`.
- [ ] `requireFeature(orgId, "ai_distribute")` throws `ForbiddenError` when the org is on `free`.
- [ ] `<FeatureGate feature="ai_distribute">` renders an upgrade card when the org lacks it.
- [ ] User can configure their AI provider + API key on `/settings/ai`.
- [ ] Calendar's "🪄 IA" button opens a real distribute flow that calls the AI and returns a preview.
- [ ] User confirms preview → hours logged via existing endpoint.
- [ ] No regression on existing flows.

---

## 7. Estimated effort

- §5.1 schema: 1h
- §5.2 billing pkg: 1h
- §5.3 cloud helpers: 0.5h
- §5.4 FeatureGate UI: 0.5h
- §5.5 AI config + vault: 1h
- §5.6 @timeflow/ai package port (minimum: types + factory + anthropic): 1.5h
- §5.7 distribute endpoint: 1.5h
- §5.8 settings page: 1h
- §5.9 calendar wire: 1.5h
- README + plan doc: 0.5h

**Total: ~10h.** Pushing scope: ship α + tier infra fully, β minimum viable (Anthropic only, no streaming), the rest spec'd here for follow-up if I run long.

---

## 8. Follow-up plans

- **Plan 019** — GitLab adapter (018-γ).
- **Plan 020** — Stripe integration: subscription lifecycle + plan-change webhooks + `/pricing` page + checkout.
- **Plan 021** — Multi-provider AI config UI + streaming responses + per-provider quotas.
- **Plan 022** — Annual pricing toggle + discount codes.
