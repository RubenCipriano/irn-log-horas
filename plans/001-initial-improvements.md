# Improvement Plan: IRN Log Horas

## Context

The app logs work hours to OpenProject but has several bugs and missing features:
- **"No Tasks for this month"** error caused by wrong status field extraction, date handling bugs, and overly restrictive month filtering
- **Incorrect summer/winter hours** due to hardcoded schedule with no configurability
- **No way to assign tasks to days** or configure hours dynamically
- **Weak recommendation engine** with hardcoded limits and no editing
- **923-line monolithic Calendar component** needs decomposition

---

## Phase 0: Foundation

**Goal:** Shared types, plans folder, and project structure.

### Files to create:
- `plans/001-initial-improvements.md` — copy of this plan for history
- `types/index.ts` — centralized types (currently duplicated in `app/page.tsx:6-10` and `components/Calendar/index.tsx:6-15`)

### Types to define in `types/index.ts`:
- `TodoItem` — add `date: Date | null` (was non-nullable, causes Invalid Date crashes)
- `Holiday`, `SelectedDay`, `Recommendation` — move from Calendar
- `WorkSchedule` — NEW: `{ summer: { monThu, fri }, winter: { monThu, fri }, summerMonths: [start, end] }`
- `TaskAssignment` — NEW: `{ taskId, taskTitle, dayKey }`

### Update imports in:
- `app/page.tsx` — import from `@/types`
- `components/Calendar/index.tsx` — import from `@/types`

**Verify:** `npm run build` passes, no behavior changes.

---

## Phase 1: Critical Bug Fixes

**Goal:** Fix the two showstopper bugs.

### 1A: Fix status extraction — `app/api/openproject/verify-token/route.ts`
- **Line 71:** `wp._links?.status?.title` may be undefined. Change to:
  ```
  status: wp._links?.status?.title || wp._embedded?.status?.name || "Unknown"
  ```
- **Line 69:** Uses `createdAt` as date — tasks group by creation date, not work date. Change to `wp.startDate || wp.dueDate || wp.createdAt || null`
- **Line 72:** `.filter(todo => todo.date !== null)` drops dateless tasks. Remove this filter — tasks without dates should still be available for recommendations

### 1B: Fix Invalid Date — `app/page.tsx`
- **Lines 47-50 and 90-93:** `new Date(todo.date)` on null = Invalid Date. Guard: `todo.date ? new Date(todo.date) : null`

### 1C: Fix Calendar null date handling — `components/Calendar/index.tsx`
- **todoMap (line 438-445):** Skip todos with null/invalid dates: `if (!todo.date || isNaN(todo.date.getTime())) return;`
- **monthDevelopmentTasks (lines 448-460):** **Remove month/year filter entirely.** All in-progress tasks should be available for recommendations regardless of their date. Only keep the status filter.

### 1D: Expand status list — `components/Calendar/index.tsx`
- **Lines 23-25:** `IN_PROGRESS_STATUSES` is too narrow. Add: `"em progresso"`, `"a desenvolver"`, `"em teste"`, `"testing"`, `"in development"`, `"new"`, `"novo"`, `"open"`, `"aberto"`, `"em curso"`, `"em execução"`

**Verify:** Login with token, tasks appear regardless of creation month, no "NaN" keys, recommendations work.

---

## Phase 2: Dynamic Hours Configuration

**Goal:** Fully configurable work schedule with "Verao"/"Inverno" mode selector and per-season hours.

### 2A: Create `hooks/useWorkSchedule.ts`
- Default: Summer Mon-Thu=7h, Fri=9h; Winter Mon-Thu=9h, Fri=9h; Summer months=[3,9) (April-August)
- Persists to localStorage key `work_schedule`
- Exposes: `schedule`, `saveSchedule`, `isSummerTime(date)`, `getExpectedHours(date)`

### 2B: Create `components/ScheduleSettings/index.tsx`
- Collapsible settings panel with:
  - Dropdown: "Verao" / "Inverno" season selector to configure each independently
  - Number inputs for Mon-Thu hours and Friday hours per season
  - Dropdowns for summer start/end months (using Portuguese month names)
  - "Repor Padrao" (Reset) and "Guardar" (Save) buttons

### 2C: Integrate into Calendar
- Remove standalone `isSummerTime()` (line 41-44) and `getExpectedHours()` (line 46-52) functions
- Use `useWorkSchedule()` hook instead
- Render `<ScheduleSettings />` near the existing meetings task config area (around line 504)

**Verify:** Change hours in settings, calendar colors update immediately, settings persist on reload.

---

## Phase 3: Task Assignment (Pinning + All In-Progress Available)

**Goal:** All in-progress tasks available for recommendations on any day, PLUS ability to pin specific tasks to specific days for priority.

### 3A: Create `hooks/useTaskAssignments.ts`
- State: `Map<dayKey, TaskAssignment[]>` persisted in localStorage key `task_assignments`
- Methods: `assignTask(taskId, taskTitle, dayKey)`, `unassignTask(taskId, dayKey)`, `getAssignmentsForDay(dayKey)`

### 3B: Create `components/TaskAssignmentModal/index.tsx`
- Opens from the day detail modal
- Shows all in-progress tasks with search/filter input
- Each task has "Adicionar"/"Remover" toggle
- Already-pinned tasks shown at top with visual distinction

### 3C: Modify Calendar day detail modal
- Add "Atribuir Tarefas" button in day detail modal (after line 766)
- Show pinned tasks visually distinct from API-date-based tasks (pin icon)
- Merge pinned tasks into `todoMap` via useMemo

### 3D: Modify recommendation engine
- **Priority order:** 1) Tasks pinned to this specific day, 2) All in-progress tasks (no month filter)
- Pinned tasks get hours allocated first, then remaining hours distributed among other in-progress tasks

**Verify:** Can pin tasks to days, pinned tasks appear on calendar, recommendations prioritize pinned tasks.

---

## Phase 4: Improved Recommendation Engine

**Goal:** Smarter, configurable, editable recommendations.

### 4A: Extract to `lib/recommendations.ts`
- Move `calculateHoursRecommendation` out of Calendar (lines 222-285) into a pure function
- Remove the IIFE pattern in JSX (lines 770-792), use a memoized variable instead

### 4B: Configurable parameters
- `meetingsHours` (default 0.5, currently hardcoded line 247)
- `maxHoursPerTask` (default 3, currently hardcoded line 256)
- Store in localStorage, expose via settings UI

### 4C: Better distribution algorithm
- Equal distribution: `remainingHours / taskCount`, capped at `maxHoursPerTask`
- Re-distribute overflow from capped tasks to remaining tasks
- Round to nearest 0.5h for cleanliness
- Return `shortfall` field when unable to fill all hours

### 4D: Editable hours in confirmation modal
- In confirmation modal (lines 801-868), replace static hour display with editable number inputs
- User can adjust each task's hours before confirming
- Total auto-updates as hours are edited

### 4E: Shortfall warning
- When `shortfall > 0`, show yellow warning: "Faltam X horas. Considere adicionar mais tarefas."

**Verify:** Recommendations fill expected hours, can edit before saving, shortfall warning shows when needed.

---

## Phase 5: Component Decomposition

**Goal:** Split 923-line Calendar into focused sub-components.

### Target structure:
```
components/Calendar/
  index.tsx              — Orchestrator (state, hooks, data flow) ~150 lines
  CalendarGrid.tsx       — 7-column day grid ~100 lines
  CalendarHeader.tsx     — Month navigation + title ~50 lines
  DayCell.tsx            — Individual day cell ~60 lines
  DayDetailModal.tsx     — Selected day modal ~120 lines
  TaskModal.tsx          — Selected task modal ~40 lines
  ConfirmationModal.tsx  — Save confirmation ~80 lines
  ClearHoursModal.tsx    — Delete confirmation ~50 lines
  MeetingsTaskConfig.tsx — Meetings task ID config ~40 lines
```

### Extract utilities:
- `lib/calendar-utils.ts` — `formatHours`, `toKey`, `getHoursStatus`, `getHoursStatusColor`, `getDaysInMonth`, `getMonthStartOffset`, `isValidDate`
- `lib/holidays.ts` — `getEasterSunday`, `addDays`, `getPortugalHolidays`

**Verify:** All functionality identical, `npm run build` passes, each component < 150 lines.

---

## Phase 6: Quality & Polish

### 6A: Error handling
- Meetings task fetch failure: show visible error in UI instead of just `console.error`
- API errors: user-friendly Portuguese messages

### 6B: Fix `get-task` auth inconsistency
- `app/api/openproject/get-task/route.ts` receives pre-encoded Basic auth while other routes receive Bearer token. Make consistent: receive Bearer, encode server-side.

### 6C: Layout metadata — `app/layout.tsx`
- Title: "Registo de Horas - IRN"
- `lang="pt"` instead of `lang="en"`

### 6D: Remove console.log from production
- Gate behind `process.env.NODE_ENV === "development"` or remove

**Verify:** `npm run build` and `npm run lint` pass clean, no console.log in production.

---

## Phase Dependency Graph

```
Phase 0 (Foundation) -> Phase 1 (Bug Fixes) -> Phase 2 (Dynamic Hours)
                                             -> Phase 3 (Task Assignment)
                                             -> Phase 4 (Recommendations)
                                                        |
                                              Phase 5 (Decomposition)
                                                        |
                                              Phase 6 (Polish)
```

Phases 2, 3, 4 can be done in any order after Phase 1. Phase 5 should come after all feature work. Phase 6 is final cleanup.

---

## Verification (End-to-End)

1. `npm run build` — no errors
2. `npm run lint` — clean
3. `npm run dev` — login with OpenProject token
4. Verify tasks appear regardless of creation month
5. Change schedule in settings, verify calendar colors update
6. Pin tasks to a specific day, verify they appear and get priority in recommendations
7. Click a day, verify recommendation fills expected hours
8. Edit hours in confirmation modal, save, verify entries created in OpenProject
9. Clear hours for a day, verify entries deleted
10. Reload page — all settings (schedule, pins, meetings task) persist
