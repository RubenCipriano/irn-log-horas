# Architecture — IRN Log Horas

High-level map of how the app fits together. Each box links to a per-folder
README with more detail.

```
                              ┌─────────────────────────┐
                              │  app/layout + page.tsx  │
                              │  ── AppShell wrapper ── │
                              └──────────┬──────────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
       ┌────────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐
       │  TopBar         │      │  Sidebar        │      │  SettingsDrawer │
       │  (month / view  │      │  (user, sprint, │      │  (Horario /     │
       │   toggle / cmd) │      │   task list)    │      │   IA / Kanban / │
       └────────┬────────┘      └────────┬────────┘      │   Meetings /    │
                │                        │               │   Historico)    │
                └────────────┬───────────┘               └─────────────────┘
                             │
                  ┌──────────▼──────────────┐
                  │  view === "calendar"    │
                  │  Calendar/index.tsx     │
                  │  ┌───────────────────┐  │
                  │  │ MonthGrid         │  │
                  │  │  └ DayCell        │  │
                  │  │     └ Pip rows    │  │
                  │  └───────────────────┘  │
                  └──────────┬──────────────┘
                             │
                  ┌──────────▼──────────────┐
                  │  view === "kanban"      │
                  │  Kanban/Board.tsx       │
                  │   └ Column → Card       │
                  └─────────────────────────┘
```

## Tracks

- **Calendar track** — month-grid view of hours per day. Owns `DayCell`,
  `TaskModal`, `DayDetailModal`. See [components/calendar.md](components/calendar.md).
- **Kanban track** — drag-and-drop status board (Phase 11). See
  [components/kanban.md](components/kanban.md).
- **AI track** — command palette → orchestrator → preview modal. See
  [components/ai-flow.md](components/ai-flow.md) and [ai/charter.md](ai/charter.md).
- **GitLab track** — fetches commits/MRs as evidence for the AI. See
  [components/gitlab.md](components/gitlab.md).

## State boundaries

- **Server state** — fetched on demand from OpenProject via `app/api/openproject/*`
  routes. The browser never holds the API token longer than a single page load
  (it lives in `localStorage` keyed `openproject_token`).
- **Local persistence** — `hooks/use*.ts` files own one localStorage key each.
  See `CLAUDE.md` for the full key map.
- **Ephemeral UI state** — modals, drag overlays, selected day. Owned by the
  nearest sub-component; never lifted higher than needed.

## Where the AI plugs in

`hooks/calendar/useAIFlow.ts` is the orchestration layer between the command
palette and the AI preview modal. It is view-agnostic — the Kanban can call
the same hook in a future phase to power "update statuses for the visible
column" actions.

## Files larger than 300 lines

Tracked as tech debt. Phase 12 refactored `components/Calendar/index.tsx`
(was >1000 lines) into the hooks under `hooks/calendar/` and the
sub-components under `components/Calendar/`. New code must respect the
300-line ceiling; CI will flag violations once the rule lands.
