# Kanban

Drag-and-drop status board. Columns are user-configurable (Phase 11).

## Key files

- `components/Kanban/Board.tsx` — column layout + DnD orchestration.
- `components/Kanban/Column.tsx` — one column, drop target, inline reorder
  controls (← → ×).
- `components/Kanban/Card.tsx` — one task, drag source. Click → opens
  `TaskModal` (same modal calendar uses).

## Drag-and-drop

HTML5 native (`draggable`, `onDragStart`, `onDragOver`, `onDrop`). The data
shape is one taskId in `dataTransfer`. We chose this over dnd-kit because
the use case doesn't need sortable lists within a column (the column order
is the AI's view, not the user's preference per card).

## Status writes

`Board.handleDropTask` calls `/api/openproject/update-status` with the
target `statusId`. Optimistic update first; revert + toast on failure.
This is the same path the AI uses for `update_status` actions — see
[ai-flow.md](ai-flow.md).

## Column config

`hooks/useKanbanColumns.ts` persists `kanban_columns_v1`. Columns can be
hidden (live in the "Outros" overflow column) and reordered. Defaults =
all visible non-closed statuses.
