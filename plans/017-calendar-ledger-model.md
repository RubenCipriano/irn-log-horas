# Plan 017 — Calendar UX overhaul: ledger model + explicit sprint filter + cleaner modal

**Created**: 2026-05-25
**Depends on**: Plans 010-B (cloud calendar foundations), 013 (filters), 015 (org policy), 016 (sprints + status pip + task metadata)
**Status**: In progress.

> Cloud calendar today renders every "active" task on every day → "+45 more" everywhere → unreadable. The OSS web app is the gold standard: days are EMPTY by default and the user ADDS tasks (with hours) to each day. Same data set, totally different paradigm. This plan flips cloud to the OSS ledger model.

---

## 1. Why this slice exists

Side-by-side from live test:

| | Cloud (current) | OSS web (target) |
|---|---|---|
| Day cell content | Every task active that day | Tasks with hours logged that day |
| Empty day | 3 task chips + "+45 more" | Empty (just date + expected hours) |
| Modal | Lists "active tasks" with hour inputs | "Progresso do dia X/Y" + "Tarefas do dia" + "+ Adicionar tarefa" |
| Sprint chip | Auto-picks (and gets it wrong on multi-project orgs) | No auto-pick; sidebar dropdown chooses |

The user's quote: *"the status and such for the tasks should only appear if there's hours in that day like the normal web calendar, where I could add and distribute the hours"*.

The cloud's "predictive" model — show every task that *could* be worked on — is the right data engine but the wrong default surface. It belongs inside the "+ Add task" flow (smart-rank what to suggest), not splattered across every cell.

---

## 2. Scope

### In scope

**Sprint UX:**
- Remove auto-pick of an "active sprint". Sprints become an explicit URL filter (`?sprint=<id>`) just like project filter.
- New dropdown in the calendar header next to "Project" — "All sprints" by default.
- When a sprint IS selected: chip in the header shows the selected name + date range; indigo ring renders on its days; the recently-active filter is replaced by "task overlaps sprint dates".
- When no sprint is selected: no chip, no ring. Nothing forced on the user.

**Ledger-model day cells:**
- Day cells render tasks WITH HOURS LOGGED on that day (from `loggedHoursByTask[dayKey]`), not all "active" tasks.
- Each chip shows `Xh — Task title` so hours are visible at a glance.
- Empty days render as empty (date + expected hours only).
- "+N more" only when more than 3 logged tasks (rare).

**OSS-style day modal:**
- Header: weekday + date (e.g. "TERÇA-FEIRA · 26 de maio de 2026").
- Progress bar: `0:00h / 9h` with `Falta 9:00h` (or "Completo" when full).
- "TAREFAS DO DIA" section listing the day's logged tasks (clickable to edit hours / change status / open upstream).
- "+ Adicionar tarefa" button → expands an inline picker:
  - Searchable list of the user's assigned tasks (status filter still applies).
  - Smart-ranked: the recommendation engine's top picks float to the top.
  - Click a task → adds it to the day with a suggested hour value the user can adjust → saves on confirm.
- Empty state: friendly "Nenhuma tarefa. Usa + Adicionar tarefa para escolher as tuas." copy.
- Bottom: "🪄 IA" button — stub for now, opens an "AI coming in plan 016-ε" toast. Plan 018 wires the real flow.

**Animations / polish:**
- Modal slide-in from right (transform + opacity) instead of instant pop.
- Day cell hover: subtle background tint + lift via `transition`. No content shift.
- Modal close on Esc + backdrop click already worked; keep + add focus return to the clicked day cell.
- Button focus rings consistently 1px indigo so keyboard nav reads.

### Explicitly out of scope

- AI distribute palette (Ctrl+K). Plan 016-ε. The "IA" button stubs for now.
- GitLab activity ribbon. Plan 016-δ.
- Task pinning (manual day assignment without hours). Plan 016-λ.
- Settings drawer (per-user status weight / timeline inference / sprint window). Plan 016-ζ.
- Theme toggle. Plan 016-η.
- Kanban/week views. Plan 016-θ.
- Bulk actions (week-fill, month-fill, clear). Plan 016-ι.
- Keyboard shortcuts beyond Esc. Plan 016-κ.

---

## 3. Security checks

| Check | Where |
|---|---|
| `?sprint=<id>` validated server-side before scoping — refuses unknown ids rather than empty-filtering | calendar page sprint parsing |
| Task picker only shows tasks the user is ASSIGNED to (already filtered by `listAssignedTasks`) — never leaks team-wide task lists | reuses `filteredTasks` |
| "+ Adicionar tarefa" → log-hours flow goes through the existing per-task worklog endpoint with the same `requireOrgRole(orgId, "developer")` gate | no new endpoint |
| Closed-status confirm still fires when user changes a task to a closed status from the modal | day-detail unchanged |

---

## 4. Implementation order

1. Sprint URL filter (replaces auto-pick).
2. Day cell ledger model — show logged tasks, not active tasks.
3. Day modal: progress bar + "Tarefas do dia" + "+ Adicionar tarefa" picker.
4. Animations + polish.

---

## 5. Estimated effort

- §4.1 sprint filter: 1h
- §4.2 ledger cells: 1h
- §4.3 modal rebuild: 2.5h
- §4.4 animations: 0.5h
- Plan doc + README: 0.5h

**Total: ~5.5h / one focused session.**

---

## 6. Follow-up

- Plan 016-ε — AI distribute palette wires the "🪄 IA" button to real action.
- Plan 016-λ — task pinning lets users mark a task as "for this day" without yet logging hours (in-between state between empty and logged).
