# Plan 008 — Cloud / Web integration, reported bugs, security re-audit

**Created**: 2026-05-25 (end of day session)
**Current phase**: Phase 3 (slice 1 shipped — invites + marketplace + standalone Docker)
**Status**: Cloud SaaS scaffolding is real, but several gaps make it feel incomplete vs the OSS Web app. This doc captures what's broken, what's missing, and the next-session ordering.

---

## 1. Where the plan currently sits

| Phase | Status | Notes |
|---|---|---|
| Phase 0 (open-core split, AGPLv3, rebrand) | ✅ Done | apps/web + apps/cloud + packages/* monorepo |
| Phase 1 (cloud foundation, RBAC, approval mode, notifications, 2FA, GDPR, audit, Native PM, squads, onboarding, timezone) | ✅ Done — but with bugs (see §2) |
| Phase 2 (approval workflow, billing reports, leave, capacity, rate-limit, Jira/Linear adapters, streaming AI) | ✅ Done — Jira/Linear adapters lack connect UI |
| Phase 3 slice 1 (invites + marketplace + image-size cuts) | ✅ Just shipped |
| Phase 3 remaining (PWA, GitHub Issues adapter, shareable client report link, role explainer on invite, **cloud↔OpenProject consumption UI**) | ❌ Not started |
| External deps blocked (Stripe trial, Inngest jobs, Sentry, real email delivery) | ❌ Needs accounts |

**Key truth**: the cloud app today is "TimeFlow with Native PM" — it does NOT pull from OpenProject the way `apps/web` does. The OpenProject adapter is implemented but has no UI consuming it. This is the single biggest gap and the user has named it.

---

## 2. Reported bugs from the live-deploy test (2026-05-25 evening)

Severity: **C** = critical, **H** = high, **M** = medium, **L** = low

| # | Bug | Sev | Notes |
|---|---|---|---|
| 1 | **QR code doesn't render** at `/security/2fa` — shows the raw `otpauth://...` URI as text instead of an actual scannable QR | H | Users with a TOTP app can still copy-paste the URI but the experience is broken |
| 2 | **No logout button anywhere** in the cloud app | H | `signOut` from auth-client exists; needs to be wired to a button on dashboard / settings |
| 3 | **Can't change preferences after onboarding** — approval mode is picked once at `/onboarding/approval-mode` then never re-exposed | H | API exists (`PATCH /api/preferences/approval-mode`); /settings/preferences shows timezone only |
| 4 | **Can't delete an organisation** | H | Only flow is delete-account, which is blocked by sole-owner check. Need org-delete endpoint + UI (Owner only, hard confirm) |
| 5 | **Sole-owner blocks account delete with no way out** — the dialog tells you what to do but there's no UI for either "transfer ownership" or "delete org first" | H | Same fix as #4 covers this — once org-delete exists the user has an escape hatch |
| 6 | **Cloud doesn't pull OpenProject data** at all even after connecting via /settings/integrations | C (feature) | Adapter is implemented; UI consumption isn't built. See §4 |
| 7 | **Cloud and Web feel like two products** — overall integration concern | C (feature) | Symptom of #6 + missing OpenProject pages in cloud |
| 8 | **Security implementation needs validation** | H | Re-audit findings in §3 |

---

## 3. Security re-audit findings (preliminary — full pass scheduled for next session)

Looking at what's shipped vs what audit #2 covered:

**What's known good** (verified in audits #1 and #2):
- All API routes session-gated
- RBAC on mutations
- Tenant isolation via tenant-check before any cross-table query
- IDOR-safe (scoped by session userId)
- Drizzle parameterized queries (no SQLi)
- HttpOnly + SameSite=Lax cookies (CSRF via Better Auth)
- audit_log + worklog_weeks.approved_by + native_projects.createdBy etc. all `ON DELETE SET NULL` for GDPR
- AES-256-GCM vault for integration credentials with HKDF-derived per-record keys
- Better Auth rate-limit on signup/login/2FA (30/min)
- Per-route rate limits on /api/integrations/openproject + /api/account/export + /api/invites
- Production env validation at boot (instrumentation.ts)
- Integration validation errors bucketed (no upstream body leak)

**What needs re-validation in next session** (since slice 1 of Phase 3 + bugfixes will touch security):

| Area | Concern | Fix-of-the-fix |
|---|---|---|
| Org delete (new) | Need to ensure delete cascade doesn't orphan workspace data in stuck states; need to require owner role + password re-auth | Owner-only RBAC + password challenge + audit |
| Logout (new) | Need to ensure cookie is properly cleared + session is revoked server-side | Use `signOut` from better-auth (handles both) + audit `auth.logout` |
| QR code rendering | If we add a QR lib, ensure no XSS surface — content is server-generated, but render via SVG not innerHTML | Pure inline SVG render with TextEncoder; no DOM injection |
| Change-approval-mode UI | API already validates org policy + membership; UI just needs to surface | Already covered — re-test |
| Invite acceptance | Confirm `auth.api.getSession` is called before accept (already is); confirm token isn't echoed back via any GET (already isn't); confirm email mismatch warning works | Already covered — manual test |
| Cloud↔OpenProject consumption | New attack surface: passing through user actions to upstream. Need: rate-limit per (org, integration), error bucketing, never log full responses | Major addition — design before implementing |
| Multi-org context | `getCurrentMembership` returns oldest membership — user can't easily switch orgs. Not a security issue but limits the multi-tenant model. URL-scoped routing `/[orgSlug]/*` is the proper fix | Phase 3 / Phase 4 |

**New attack surfaces introduced this session** (slice 1 + bugfixes):
- `/api/invites/accept` (✓ scoped by token, audited)
- `/api/invites` (✓ rate-limited, RBAC, role-cap check)
- (Pending) `/api/orgs/[id]/delete` — requires owner RBAC, password challenge, cascade audit
- (Pending) `/api/account/logout` — Better Auth handles, just needs UI wiring

---

## 4. The big rock — Cloud ↔ Web integration

The OSS `apps/web` is a complete OpenProject-backed calendar with AI distribute, GitLab activity, status timeline, hours logging. The cloud app currently has none of this. To make them "the same product", we need cloud to consume the OpenProject adapter the same way `apps/web` does its direct API calls.

### Proposed Phase 3 slice 2: Cloud OpenProject consumption (3-5 sub-slices)

**4.1 Adapter context plumbing** (foundational, small)
- `apps/cloud/lib/adapter-ctx.ts`: builds an `AdapterCtx` for an org — decrypts credentials, attaches Redis cache + rate limiter
- `apps/cloud/lib/adapter.ts`: `getOrgAdapter(orgId, integrationId)` — looks up `org_integrations` row, decrypts via vault, returns ready-to-use adapter + ctx
- New `adapter_call` rate limit per (org, integration) — already defined in `@timeflow/cache`, just wire it

**4.2 Projects + tasks browsing** (medium)
- `/projects` page — lists all sources: Native + connected integrations (OpenProject, eventually Jira/Linear). Server-rendered grid.
- `/projects/[source]/[id]` page — project detail with task list. For OpenProject, uses `listAssignedTasks(ctx, { projectId })`.
- Cache: 5min per Redis key `org:{id}:openproject:projects`

**4.3 Log hours flow against OpenProject** (medium)
- Reuse the `LogHoursButton` pattern from Native PM but route to `adapter.logHours()`
- Same approval-mode resolver flow — billable projects from OpenProject can be flagged in `org_integrations.config` (e.g. project_id allowlist)
- Audit `hours.created` with `resource: "openproject_worklog"` so the audit log shows both native + remote hours

**4.4 Sync layer for AI** (medium-large)
- Periodic Inngest job (deferred — needs Inngest account) pulls OpenProject activity timeline + GitLab commits into a cloud-side cache table
- The cloud AI flow then has the same activity-aware engine as `apps/web`
- Until Inngest: pull-on-demand at request time

**4.5 Calendar view** (large — the apps/web calendar ported)
- Calendar UI that's integration-agnostic — driven by the adapter contract
- Same status timeline, status pip, AI palette flow
- This is the most user-visible "they're the same product" moment

### Suggested ordering for next session
1. **Day 1 morning**: bugfixes (§2 items 1-5) + plan doc updates — closes the immediate UX gaps the user hit
2. **Day 1 afternoon**: security re-audit pass (§3) — verify all the above + the new endpoints
3. **Day 2**: §4.1 adapter context plumbing + §4.2 projects/tasks UI — first vertical slice where cloud actually reads OpenProject data
4. **Day 3**: §4.3 log-hours through adapter + §4.5 calendar (or split if time-bound)

---

## 5. Other gaps not yet addressed (carry-overs)

From Phase 2 close-out audit (#2):
- `getCurrentMembership` picks oldest — multi-org users can't switch. URL-scoped `/[orgSlug]/*` routing planned for Phase 4.
- No rate limit per (org, integration) on adapter calls (limit exists in `@timeflow/cache`, just needs to be wired when §4.1 lands).
- Better Auth password change doesn't auto-revoke other sessions (default behavior — flag).

From Phase 3 plan §4:
- PWA manifest + service worker + offline queue — needed before mobile users land
- Annual pricing toggle — needs Stripe (external)
- Role explainer overlay on invite flow — small polish, deferred
- Shareable client report link (Viewer + expiry token) — medium
- GitHub Issues adapter — medium (mirror of Jira/Linear pattern)
- Performance audit pass — once §4 is real

From Phase 4 long-term:
- Auto-log mode (nightly AI draft) — needs Inngest
- Anomaly detection — needs at least 30 days of historical data per org
- Forecasting — needs Inngest
- Webhook system for Native PM
- SSO (SAML/OIDC) — Scale tier
- Public REST API

---

## 6. What gets shipped in this end-of-day session

Before sleeping, I'm doing the **quick wins** that unblock the user from testing further:

1. ✅ Real QR code rendering in `/security/2fa` (inline SVG, zero new deps)
2. ✅ Logout button on dashboard
3. ✅ Approval-mode change UI in `/settings/preferences`
4. ✅ Org-delete flow (Owner only, audited)
5. ✅ This plan doc

Everything else listed above is for the next session.

---

## 7. How to pick this up tomorrow

When you start the next session:

1. Re-read this doc top to bottom
2. Run `./deploy.bat` to confirm the latest build works
3. Test the 4 bugfixes shipped tonight (QR, logout, change preferences, delete org)
4. Then pick:
   - Path A: Continue closing remaining Phase 3 items (PWA, GitHub adapter, polish)
   - Path B: Jump to §4 (cloud ↔ OpenProject) — the user explicitly asked for this; highest perceived value
   - **Recommended: Path B**. The plan calls it "Phase 3 slice 2" but it's the actual unification of the two apps and the biggest reason a customer would notice "now it's the same product".

The security re-audit (§3) is a small inline pass — do it as part of any new endpoint, not a separate slice.
