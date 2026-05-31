# Plan 016 — Calendar parity with apps/web

**Created**: 2026-05-25
**Depends on**: Plans 009, 010-A, 010-B (γ + δ), 013, 015
**Status**: In progress. Sub-slices α (sprints), β (status pip), γ (task status change) ship in this session. Rest spec'd here for later sessions.

> The OSS web calendar (apps/web) is the gold standard — it's been iterated on for months. Cloud's MVP calendar shipped the structural skeleton (month grid, day cells, recommendations, log-hours) but is missing the polish that makes it feel like a daily-driver tool: sprints, GitLab activity ribbon, status pip per task, status timeline strip, AI palette, settings drawer, status change action, theme toggle, week/kanban views, bulk fill actions, keyboard shortcuts. This plan audits the gap and stages the catch-up.

---

## 1. Gap audit

| Feature | apps/web | apps/cloud | Plan 016 slice |
|---|---|---|---|
| Month grid | ✅ | ✅ | — |
| Day cell with active tasks | ✅ | ✅ | — |
| Holidays | ✅ (PT) | ✅ (org-config, 20 presets across 5 countries) | — |
| Expected hours per day | ✅ | ✅ (org-policy schedule) | — |
| Actual logged hours overlay | ✅ | ✅ (plan 010-B-δ) | — |
| Status-status color coding (green/red/yellow) | ✅ | ✅ | — |
| Loading skeleton | ✅ | ✅ | — |
| Recommendations engine | ✅ | ✅ (shared `@timeflow/domain`) | — |
| Project filter | (n/a) | ✅ | — |
| Per-user status filter | (n/a) | ✅ | — |
| **Sprint detection + filter sidebar** | ✅ (auto-pick sprint, filter task list) | ❌ | **α (this session)** |
| **Sprint ring on day cells** | ✅ (indigo ring on sprint days) | ❌ | **α (this session)** |
| **Status pip per task** (colored dot reflecting weight) | ✅ | ❌ | **β (this session)** |
| **Activity timeline strip** in day modal | ✅ (segmented bar by status, inferred-gap diagonal stripes) | ❌ | β (this session — port from apps/web) |
| **Change task status from calendar** | ✅ (TaskModal has status dropdown that PATCHes via `adapter.updateStatus`) | ❌ | **γ (this session)** |
| GitLab activity ribbon (commits + MRs per task per day) | ✅ | ❌ | **δ (next session)** |
| AI distribute palette (Ctrl+K) | ✅ | ❌ | **ε (next session)** |
| Settings drawer (Schedule / Weights / AI / Meetings) | ✅ | Partial (org policy at /settings/org-policy; per-user weights + AI provider config don't exist yet) | **ζ (next session)** |
| Status weights configurable in UI | ✅ (per-user localStorage) | ❌ | ζ (next session) |
| Timeline inference settings | ✅ | ❌ | ζ (next session) |
| Theme toggle (light/dark) | ✅ | ❌ | η (small follow-up) |
| Kanban view | ✅ | ❌ | θ (medium follow-up) |
| Week view | ✅ | ❌ | θ (medium follow-up) |
| Hover toolbar on day cells (quick fill / clear) | ✅ | ❌ | ι (small follow-up) |
| Week-fill / month-fill bulk actions | ✅ | ❌ | ι |
| Clear day / clear month modals | ✅ | ❌ | ι |
| Keyboard shortcuts (T, W, M, S, ←, →, Esc, Ctrl+K) | ✅ | ❌ | κ (small follow-up) |
| Command palette | ✅ | ❌ | κ |
| Task pinning to specific days | ✅ | ❌ | λ (small) |
| Meetings task (always included with 0.5h placeholder) | ✅ | ❌ | λ |
| Optimistic updates on cell coloring | ✅ | Partial | λ |
| Searchable task list sidebar | ✅ | ❌ | μ (small) |
| Toasts | ✅ | ❌ (inline errors only) | μ |

---

## 2. This session — sub-slices α + β + γ

### α — Sprint support

**Adapter contract extension:**
- New optional method `IProjectIntegration.listSprints(ctx, opts?: { projectId?: string })` returning `Sprint[]`.
- Normalised shape:
  ```typescript
  type Sprint = {
    id: string;
    name: string;
    projectId?: string;
    startDate: string | null;  // YYYY-MM-DD
    endDate: string | null;
    isActive?: boolean;        // currently-running, by date range
  };
  ```
- OpenProject implementation: queries `/api/v3/versions` (these are OP's sprints/milestones), maps `startDate` + `endDate`. Cache 30min — sprint dates rarely change mid-day.
- Jira + Linear leave `listSprints` undefined; the calendar degrades to "no sprint highlight".

**Cloud calendar:**
- Server page fetches sprints alongside tasks + worklogs. Picks the "current" sprint (the one whose date range contains today) for the sprint-ring highlight.
- DayCell gets an `inSprint` boolean → indigo ring around the day number when true.
- Header gets a sprint summary chip showing the current sprint's name + date range.

**Sprint as config (the user's question):** sprint *behaviour* is per-user UX, not org policy. The OSS auto-picks the sprint with most tasks; cloud can do the same. A future slice exposes a "sprint window: prev/current/next" toggle in user preferences. The DATA (which sprints exist, when they run) comes from the integration — that's not configurable.

### β — Status pip per task

Tiny coloured dot at the start of each task row in DayCell, reflecting the status weight on that specific day:
- weight ≥ 0.8 → emerald (actively in dev)
- 0.5 ≤ weight < 0.8 → amber (review states)
- 0.1 ≤ weight < 0.5 → slate (touch-ups, QA)
- weight 0 → red (terminal — shouldn't normally show)

Same conventions apps/web uses. Cheap visual polish that makes "what am I working on" scannable.

### γ — Change task status from calendar

**API endpoint:** `POST /api/orgs/[id]/integrations/[integrationId]/tasks/[taskId]/status` with body `{ statusId }`. Owner/Admin/Manager/Tech-Lead/Developer can act on tasks assigned to them (gated by `requireOrgRole(orgId, "developer")`). Calls `adapter.updateStatus(ctx, taskId, statusId)`. Audits `task.status_changed_remote`.

**UI:** Each task row in DayDetail modal grows a status dropdown next to the hours input. Server page fetches `adapter.getStatuses(ctx)` once and passes the list. Changing the status triggers the PATCH + `router.refresh()` so the calendar reflects the new status (which affects timelines, recommendations, and the status filter).

---

## 3. Security checks

| Check | Where |
|---|---|
| `listSprints` cached per `(orgId, projectId)` — never cross-org | adapter cache key already prefixes with orgId |
| Status-change endpoint gated by `requireOrgRole(orgId, "developer")` — viewers can't modify upstream state | endpoint |
| Status-change endpoint validates the `statusId` is in the adapter's known list before calling `updateStatus` — refuses crafted/unknown ids | endpoint |
| Audit captures the before+after status names + taskId — admins can reconstruct any drift | endpoint |
| Rate-limited via the existing `adapter_call` token bucket | endpoint |

---

## 4. Acceptance criteria (this session)

- [ ] OpenProject calendar shows the current sprint name in the header.
- [ ] Days within the current sprint date range have an indigo ring.
- [ ] Each task chip in a day cell has a coloured status pip on the left.
- [ ] Day detail modal has a status dropdown per task row.
- [ ] Changing a status via the modal hits the upstream and the calendar refreshes.
- [ ] `task.status_changed_remote` audit row written on success.

---

## 5. Estimated effort

- α sprints: 2h (adapter + UI)
- β status pip: 0.5h
- γ status change: 2h (endpoint + UI + audit)
- Audit doc + README: 0.5h

**Total this session: ~5h.**

---

## 6. Deferred sub-slices

### δ — GitLab adapter for cloud
Whole new adapter (`packages/integrations/src/adapters/gitlab.ts`). RBAC-gated per plan §2.4 — Developer + Tech Lead only. Activity ribbon on day cells (count of commits + MRs). Per-task GitLab activity in the modal. Plan 008 §4.4 (AI sync layer) eventually pulls GitLab activity for the AI prompt.

### ε — AI distribute palette
Needs cloud-side AI provider config (per-user JSON in `user_preferences.aiProviderConfig`, vault-encrypted because it contains an API key). Then port apps/web's command palette + distribute flow. The shared `@timeflow/domain` already has the recommendation engine; the AI distribute prompt + parser lives in `apps/web/lib/ai/` — to share, move to `packages/ai/` or duplicate.

### ζ — Settings drawer / per-user UX config
- Per-user status weight overrides (currently `DEFAULT_STATUS_WEIGHTS`)
- Timeline inference settings (already in `@timeflow/domain` types)
- Per-user AI provider config (depends on ε's schema work)
- Sprint window (current only / current ± 1 / disabled)

### η — Theme toggle
Light/dark/system, persisted to `user_preferences.themePreference`. Tailwind 4 dark variants on every existing colour class — wide-touching but mechanical.

### θ — Kanban + Week views
Calendar route gets `?view=month|week|kanban`. Week is a simplified month with 5 columns. Kanban groups tasks by current status.

### ι — Bulk actions on day cells
Hover toolbar (Fill / Clear). Week-fill from top bar. Month-fill. Clear day modal. Clear month modal. Each maps to the existing per-task log-hours endpoint in a fan-out.

### κ — Keyboard shortcuts + command palette
Reusable `useKeyboardShortcuts` hook (already exists in apps/web). Ctrl+K palette wired to AI flow (depends on ε).

### λ — Task pinning + meetings task + better optimistic updates
Pinned task assignments persist to `user_preferences.pinnedAssignments` (JSON). Meetings task id in `user_preferences.meetingsTaskId`. Calendar engine already accepts `pinnedTaskIds` + `meetingsTaskId`.

### μ — Sidebar (searchable task list) + toasts
Left sidebar with a fuzzy-search task list + sprint dropdown. Toast component as a shared `@timeflow/ui` primitive (the DX-refactor slice will create the package).

---

## 7. Follow-up

After this session lands:
- Plan 017 → execute δ (GitLab adapter for cloud).
- Plan 018 → execute ε + ζ (AI distribute + settings drawer).
- Plan 019 → execute κ + ι + λ + μ (keyboard, bulk, pinning, sidebar — the polish bundle).
- Plan 014 (DX refactor) lands somewhere in here once the surface stabilizes.
