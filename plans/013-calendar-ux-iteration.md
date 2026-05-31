# Plan 013 — Calendar UX iteration + actual-hours overlay + DX cleanup

**Created**: 2026-05-25 (after live-deploy test of plan 010-B-γ)
**Depends on**: Plan 010-B (calendar foundations), Plan 010-A (log-hours endpoint)
**Status**: In progress.

> Live-deploy testing surfaced three real problems with the plan 010-B-γ calendar that we deliberately deferred. They turn out to be more blocking than the spec assumed. This plan fixes them and lays the groundwork for the DX cleanup the user explicitly asked for.

---

## 1. Why this slice exists

The first cloud calendar render showed "+117 more" tasks under three visible chips on EVERY weekday — and even on the Saturday/Sunday of a holiday week. That's not signal; it's noise that hides the actual work. Three root causes, all fixable in one session:

1. **OpenProject `listAssignedTasks` doesn't filter by open status.** The adapter sends `{ assignee: "me" }` only, so it returns every task ever assigned including closed ones. The cloud's post-filter `t.status?.isClosed` doesn't catch them because the adapter never populates `isClosed` on the returned `ITaskStatus`.
2. **No project filter on the calendar.** Even with open-only tasks, a busy user has 30–50 active assignments across multiple projects; only ~5 are "what I'm working on this sprint".
3. **No "recently active" filter.** Tasks that were touched 6 months ago and never closed clutter every weekday with no useful signal — they have no recent timeline segments.

Meanwhile, the user can't see their actual logged hours on the calendar OR on `/hours`. Calendar shows "tasks expected today" but no overlay for "you logged Xh today against task Y". `/hours` shows the cloud-side `worklog_weeks` table which stays at 0.00h because writes go straight to OpenProject — cloud has nothing to read back without `adapter.listWorklogs`.

Two more user reports:
- "When I click on calendar it just lets me in the same screen without doing much" — server-rendered page with no loading indicator while the per-task timeline fan-out runs (~15s for 200 tasks at concurrency 6).
- "Hours is a list, but I want to see them on the calendar" — the user expects the calendar to be the daily-tracking surface; `/hours` should be the weekly-approval surface (which is what its purpose actually is — the page wording isn't clear).

---

## 2. Scope

### In scope (this slice)

**Adapter fixes (user-visible impact: massive):**
- OpenProject `listAssignedTasks` adds the `status: { operator: "o" }` open-status filter.
- OpenProject `listAssignedTasks` populates `ITaskStatus.isClosed` from the status `/links/href` chain, so cloud-side filters that already check `isClosed` actually work as a defence in depth.

**Calendar tasks filter:**
- Cloud calendar drops tasks with no timeline segment in the last 60 days. Tasks without ANY timeline still show on weekdays (no way to filter them by recency).
- Calendar URL accepts `?project=<id>` and renders only that project's tasks. Server fetches the project list via `adapter.listProjects` once and passes it to the client so the dropdown is populated.
- Loading skeleton ([apps/cloud/app/calendar/loading.tsx](apps/cloud/app/calendar/loading.tsx)) renders the month grid shell while the server fetch runs.

**Actual hours overlay (plan 010-B-δ landing inside 013):**
- New optional `IProjectIntegration.listWorklogs(ctx, { userId, from, to })` returning a normalised `RemoteWorklog[]`.
- OpenProject implementation. Jira + Linear stubbed to return `[]` (full implementations in plan 010-B-δ-followup).
- Cloud calendar page fetches the month's worklogs alongside tasks. DayCell shows "Xh / Yh" with color coding (green = match, red = missing, yellow = mismatch).

**Page wording fixes:**
- `/hours` page header explicitly states "Weekly submission — daily logging is on Calendar." So users know where to go.
- Dashboard re-orders cards so Calendar is the prominent primary surface (already done in 010-B-γ, just reinforcing).

### Explicitly out of scope (next session)

- AI distribute palette (plan 010-C — needs cloud-side AI provider config slice first).
- Status pip per task + activity timeline strip in the day modal.
- Sprint detection + filter sidebar (project filter is enough for now).
- Settings drawer (schedule / weights / AI provider config).
- DX refactor (split CalendarView into hooks, Modal primitive, shared `@timeflow/ui` package). Spec'd in §5; execute next session — adding more files mid-iteration would muddy the diff and slow review.
- Multi-integration tabs.
- Linear / Jira full `listWorklogs` (stubs return empty; OpenProject is the customer's primary integration).

---

## 3. Security checks

| Check | Where |
|---|---|
| `listWorklogs` is gated by `requireOrgRole(orgId, "viewer")` — viewing your own hours doesn't need write permission, but it MUST be authed | calendar page (transitively) — calls `getOrgAdapter` which requires the calling page to be auth-gated; the page already calls `requireSession()` |
| `listWorklogs` queries the adapter with the CURRENT user's id derived from `adapter.validateCredentials` user lookup — never trust a userId from query params or body | OpenProject impl uses `/api/v3/users/me` to resolve, then filters time_entries by that user |
| Worklog responses cached per `(orgId, userId, from, to)` — never share across users (an org admin's PAT could see other users' entries if the cache key dropped userId) | adapter cache key explicitly includes the resolved user id |
| Project filter `?project=<id>` does NOT bypass the per-project access check — the adapter's `listAssignedTasks` with `projectId` filter still respects upstream permissions; the cloud just shows what the upstream says is visible | OpenProject `listAssignedTasks(ctx, { projectId })` already filters at the API level |
| Recently-active timeline check is cloud-side only — has no authz impact, but should never accept a `since` parameter from query (drift into "show me older tasks for someone else") | hard-coded 60-day window in the calendar page |

---

## 4. Implementation order

1. OpenProject adapter open-status + isClosed fix (drops ~50% noise immediately).
2. Project filter UI + URL handling.
3. Recently-active filter (60-day window).
4. Loading skeleton.
5. `listWorklogs` adapter contract + OpenProject impl.
6. Worklogs fetched by calendar page; DayCell shows logged hours with color.
7. `/hours` page wording.

---

## 5. Deferred — DX refactor sketch (next session)

The user explicitly asked for "more packages, hooks, libraries if needed — instead of having big files". The honest read is: the calendar code shipped in plan 010-B-γ is fine for one slice but will calcify if we keep stacking on. Spec the cleanup so we don't lose it:

- **`apps/cloud/hooks/useCalendarTasks.ts`** — extract the "tasks-per-day from timelines" `useMemo` from `calendar-view.tsx`. Single hook the day cell + recommendation engine both consume.
- **`apps/cloud/hooks/useDayRecommendations.ts`** — extract the `calculateSmartRecommendations` call + per-task hours state from `day-detail.tsx`. Day detail becomes pure presentation.
- **`apps/cloud/components/Modal.tsx`** — extract the shared backdrop + dialog primitive that `ConnectIntegrationModal`, `LogAdapterHoursModal`, `DayDetail`, and `TransferOwnershipModal` all reimplement today.
- **`packages/ui`** (only if there's actual reuse across web + cloud — TBD): theme tokens, button primitive, badge primitive. Cloud and web have diverged enough on styling that this might just be a packaging tax. Decide AFTER porting more components.
- **`apps/cloud/lib/calendar/`** subfolder for the date math, key builders, and grid construction currently inlined in `calendar-view.tsx`. Keeps the component file under ~80 LOC.

Plan 014 will execute this once 013's user-facing fixes are in production and validated.

---

## 6. Estimated effort

- §4.1 OpenProject filter: 0.5h
- §4.2 Project filter UI: 1.5h
- §4.3 Recently-active filter: 0.5h
- §4.4 Loading skeleton: 0.5h
- §4.5 `listWorklogs` contract + OP impl: 2h
- §4.6 Worklog overlay on DayCell: 1.5h
- §4.7 `/hours` wording: 0.25h

**Total: ~6.5h / one focused session.**

---

## 7. Acceptance criteria

- [ ] OpenProject adapter only returns open tasks; `isClosed` populated correctly.
- [ ] "+117 more" reduced to a manageable count (target: <10 tasks per day for a typical user).
- [ ] Project filter dropdown works; selecting a project narrows the calendar.
- [ ] Loading skeleton renders during navigation to `/calendar`.
- [ ] DayCell shows "Xh logged / Yh expected" with appropriate color.
- [ ] `/hours` page header clarifies its purpose vs Calendar.
- [ ] No regressions on existing flows (log-hours, projects detail, etc).

---

## 8. Follow-up plans

- **Plan 014** — DX refactor per §5 above.
- **Plan 010-C** — AI distribute via adapter (palette, cloud-side AI provider config).
- **Plan 010-B-ε** — Status pip per task + activity timeline strip in day modal.
- **Plan 015** — Sprint detection + sidebar filter.
- **Plan 010-B-ζ** — Jira + Linear full `listWorklogs`.
