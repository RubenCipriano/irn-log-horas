# Plan 010 — Phase 3 slice 2 (part B): Log hours through adapter + lightweight task picker

**Created**: 2026-05-25 (immediately after plan 009 closed)
**Depends on**: Plan 009 (the adapter context plumbing, `/projects/[source]/[id]` detail, `IntegrationErrorState`)
**Status**: In progress. Section §5.1–§5.4 ship in this session; §6 (calendar MVP) deferred to plan 010-B if not reached.

> Plan 009 wired the read-side of the adapter contract (list projects, list tasks). This plan wires the **write-side** — logging hours against a remote task — and surfaces it from `/projects/[source]/[id]` so a cloud user can actually act on the OpenProject/Jira/Linear data they're now seeing.

---

## 1. Why this slice exists

Plan 008 §4.3 names this as a medium-sized vertical: the user can already *see* their OpenProject tasks via plan 009, but there's no path to *log* hours against them from cloud. The Native PM logging flow exists ([`LogHoursButton`](apps/cloud/app/native/projects/%5Bid%5D/log-hours-button.tsx)), but it writes to `native_worklogs` only. For the cloud to feel like "the same product as the OSS web app", logging has to flow through the adapter back to the upstream system of record.

This is also the smallest possible "users can do real work in cloud" milestone — calendar port (§4.5) is a separate, larger slice.

---

## 2. Scope

### In scope

- New endpoint `POST /api/orgs/[id]/integrations/[integrationId]/worklog` — validates input, resolves adapter, calls `adapter.logHours()`, audits, returns the upstream worklog id
- New client modal `LogAdapterHoursModal` — generic across adapters (no per-source UI)
- `/projects/[source]/[id]` task list grows a "Log hours" action per task
- Audit action `hours.logged_remote` with `resource_type: "adapter_worklog"` so the audit log captures both native and remote hours
- Rate-limit shares the per-`(org, integration)` token bucket already in `adapter-ctx`
- Adapter error states flow through `classifyAdapterError` → `IntegrationErrorState`
- Approval-mode resolver is consulted to surface "self-approve vs manager" inline in the modal (purely informational for remote hours — the lock-week flow stays Native-only this slice)

### Explicitly out of scope (defer)

- Calendar view (large port from apps/web — plan 010-B if reached, otherwise plan 011)
- AI distribute against integration tasks (needs the sync layer / activity timeline at a minimum — plan 010-C)
- Editing a remote worklog (most adapters don't support PATCH cleanly — re-log + delete)
- Bulk multi-day logging (one entry at a time this slice)
- Worklog list / history per remote task (needs `listWorklogs` adapter method — defer; plan 010 only writes)
- GitLab activity overlay
- Apps/web → cloud localStorage migration prompt (plan 012)

### What success looks like

- A Developer in cloud who has connected OpenProject can click into a project, pick a task, and log 2h with a comment — the entry shows up in OpenProject within seconds
- A 401 from upstream (rotated token) surfaces as `IntegrationErrorState` with the "Reconnect" CTA, not a stack trace
- The audit log shows `hours.logged_remote` with the integration id + upstream worklog id, so an admin can reconcile back

---

## 3. Prerequisites

None new. Plan 009 left the adapter context plumbing ready (`getOrgAdapter`, `buildAdapterCtx`, Redis-backed rate limiter). Each adapter's `logHours(ctx, entry)` is already implemented (OpenProject native, Jira via REST worklog, Linear via comment-with-time-tag — Linear is documented as a Workaround).

---

## 4. Security checks for this slice

| Check | Where |
|---|---|
| Endpoint goes through `requireOrgRole(orgId, "developer")` — anything below blocks (e.g. Viewers cannot write hours) | `apps/cloud/app/api/orgs/[id]/integrations/[integrationId]/worklog/route.ts` |
| Adapter ctx is per-request — no credential reuse across requests; ctx falls out of scope at the catch | same file |
| Rate limit consulted via `ctx.rateLimiter.acquire()` before the upstream call — protects user's upstream account if a UI bug fires N requests | `lib/adapter.ts` already wires it; we just consume it |
| Audit logs the upstream worklog id but NEVER the user's credentials, comment body, or any upstream response body | endpoint diff field |
| Comment input sanitised: HTML stripped, 1000-char cap (mirrors Native worklog cap) | endpoint validation |
| Date validated as `YYYY-MM-DD`, hours in `(0, 24]` with 15-min granularity (same as Native) | endpoint validation |
| `integrationId` from URL is matched against `getAdapter()` registry — unknown id → 404 (not 500) | endpoint |

---

## 5. Implementation phases

### 5.1 Worklog endpoint *(2h)*

New file: [`apps/cloud/app/api/orgs/[id]/integrations/[integrationId]/worklog/route.ts`](apps/cloud/app/api/orgs/%5Bid%5D/integrations/%5BintegrationId%5D/worklog/route.ts).

Shape:

```typescript
POST body: {
  taskId: string,      // adapter-native id ("32195" for OP, "PROJ-123" for Jira, "ENG-456" for Linear)
  hours: number,       // (0, 24], 15min increments
  date: string,        // YYYY-MM-DD
  comment?: string,    // <= 1000 chars
}

Response:
  { ok: true, upstream: { id: string } }
  on error: typed (BadRequest / NotFound / RateLimit / 502 for upstream failure)
```

Auth: `requireOrgRole(orgId, "developer")`. Adapter resolved via `getOrgAdapter(orgId, integrationId)` — returns null → 404 ("integration not connected"). Adapter exists but `logHours` throws → classify + map to `IntegrationErrorKind` and return a structured error the modal can render.

### 5.2 LogAdapterHoursModal *(2h)*

New file: [`apps/cloud/components/LogAdapterHoursModal.tsx`](apps/cloud/components/LogAdapterHoursModal.tsx).

Props:
```typescript
{
  orgId: string,
  integrationId: string,
  adapterLabel: string,   // for display
  taskId: string,
  taskTitle: string,
  approvalHint?: { mode: "self" | "manager", source: string },  // optional, from approval resolver
  open: boolean,
  onClose: () => void,
}
```

UI: hours (number, step 0.25), date (date picker, defaults to today), comment (textarea). Submit fires the new endpoint. Success → toast + close + `router.refresh()`. Error → inline message; on `credentials_invalid` show "Open integration settings →" link.

State is reset on every open (same pattern as `ConnectIntegrationModal`).

### 5.3 Wire into project detail *(1.5h)*

Update [`apps/cloud/app/projects/[source]/[id]/page.tsx`](apps/cloud/app/projects/%5Bsource%5D/%5Bid%5D/page.tsx) so each adapter task row has a "Log hours" button that opens the modal pre-populated with that task's id + title.

For Native PM, tasks already have a log-hours flow ([log-hours-button.tsx](apps/cloud/app/native/projects/%5Bid%5D/log-hours-button.tsx)); the adapter section gets its own button bound to the new modal.

### 5.4 Audit + GDPR review *(0.5h)*

- Add `"hours.logged_remote"` to the audit action enum
- Mirror it in [`audit_log` indexing](packages/db/src/schema/audit.ts) — no new index needed (we keep `(org_id, created_at DESC)`)
- Confirm no new FK is introduced that would need `ON DELETE SET NULL` — this endpoint writes only to `audit_log` (we don't store the upstream worklog id elsewhere; OpenProject/Jira own it)

### 5.5 README + CLAUDE.md updates *(0.5h)*

- Add `/api/orgs/[id]/integrations/[integrationId]/worklog` to the route map (if there's one — there isn't; just changelog entry)
- README changelog entry for the slice

---

## 6. Deferred — calendar MVP scope (will become plan 010-B)

The apps/web calendar ([components/Calendar/](apps/web/components/Calendar/)) is ~1200 LOC of orchestration: month grid, status timeline, AI palette, optimistic updates, sprint ring, command-palette wiring. Porting it cleanly requires:

- A cloud-side equivalent of the `verify-token` route that fetches all assigned tasks + their activity timelines for a date range, going through the adapter
- A cloud-side recommendations engine call (existing `lib/recommendations.ts` should move into a shared package or be duplicated in `apps/cloud`)
- The AI distribute route ported with the cloud-side adapter as the activity source
- Status timeline UI components

That's a 2–3 day slice on its own. Plan 010-B will spec it; this plan stops at "user can log hours against a remote task one-at-a-time".

---

## 7. Verification

After implementing §5.1–§5.5:

1. **Happy path**: Connect OpenProject in cloud → navigate to `/projects` → pick an OpenProject project → pick a task → click "Log hours" → enter 2.5h + a comment → submit. Verify the entry exists in OpenProject (manual check on the OP UI). Audit log shows `hours.logged_remote` with the upstream id.
2. **Rate-limited**: hammer the endpoint 100 times in 60s — beyond the per-(org,integration) limit it 429s; UI shows "Try again in N seconds" without crashing.
3. **Token rotated**: edit `org_integrations.credentials` to invalid ciphertext OR rotate the OP token upstream → next log-hours attempt surfaces the "Credentials rejected" state with a link to settings.
4. **Validation**: hours = 0.1 → 400 "must be 15-min increments"; hours = 25 → 400; date = "not a date" → 400; comment 2000 chars → 400.
5. **RBAC**: Viewer role tries to POST → 403.

---

## 8. Acceptance criteria

- [ ] `POST /api/orgs/[id]/integrations/[integrationId]/worklog` exists, gated by `requireOrgRole(orgId, "developer")`
- [ ] `LogAdapterHoursModal` works for OpenProject, Jira, and Linear (same component, no per-adapter forks)
- [ ] `/projects/[source]/[id]` has a per-task "Log hours" action for adapter tasks
- [ ] Audit action `hours.logged_remote` is emitted on success (with upstream id) and on rate-limit / 401 (with `blocked: true` diff)
- [ ] No credential or upstream-response body appears in audit diffs or logs
- [ ] All four error states (`not_connected`, `credentials_invalid`, `upstream_down`, `unknown`) render via `IntegrationErrorState` when triggered
- [ ] README changelog entry written
- [ ] CLAUDE.md mentions the new endpoint pattern in the integrations section

---

## 9. Estimated effort

- §5.1 worklog endpoint: 2h
- §5.2 modal: 2h
- §5.3 wire-in: 1.5h
- §5.4 audit/GDPR: 0.5h
- §5.5 docs: 0.5h

**Total: ~6.5h / one focused session.**

---

## 10. Follow-up plans

- **Plan 010-B** — Calendar MVP (port from apps/web). Bigger slice; needs its own doc.
- **Plan 010-C** — AI distribute against adapter data. Depends on plan 010-B's data layer.
- **Plan 011** — Ownership transfer flow (separate plan, deferred from plan 009).
- **Plan 012** — Apps/web → cloud localStorage migration prompt.
