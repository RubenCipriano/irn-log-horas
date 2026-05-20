# Calendar

Month-grid view of the user's logged hours.

## Key files

- `components/Calendar/index.tsx` — orchestrator. Wires hooks + sub-components.
  Hard limit: ≤200 lines (Phase 12).
- `components/Calendar/MonthGrid.tsx` — pure grid render of `DayCell`s.
- `components/Calendar/DayCell.tsx` — one day: status pips, hours total,
  hover toolbar.
- `components/Calendar/DayDetailModal.tsx` — modal opened by clicking a day,
  shows the per-task breakdown + quick edit.
- `components/Calendar/TaskModal.tsx` — opened by clicking a sidebar task or
  a card in Kanban; status dropdown + timeline strip.
- `components/Calendar/ClearHoursModal.tsx`, `ClearMonthModal.tsx`,
  `ConfirmationModal.tsx` — confirmation dialogs.

## Backing hooks (under `hooks/calendar/`)

- `useAuthAndUser.ts` — token + url + user props relay.
- `useTaskListSync.ts` — owns `todoList`, sprint filter, freshness timestamp,
  and the palette-open refresh logic.
- `useHoursActions.ts` — save/clear hour entries (per-day + multi-day),
  optimistic updates, `savingDays` set.
- `useAIFlow.ts` — palette submit → AI orchestrator → preview modal →
  apply pipeline. View-agnostic so the Kanban can call it too.
- `useViewMode.ts` — `view` ∈ {calendar, kanban}, persisted to
  `view_mode_v1`.

## When to add a new sub-component

- The new piece has its own modal/overlay.
- It owns state that isn't shared with the grid.
- The orchestrator file is approaching its 200-line ceiling.

Anything ≤30 lines stays inline.
