# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**website-log-horas** — A Next.js web app for logging work hours to an OpenProject instance (IRN - Instituto dos Registos e do Notariado). Users authenticate with an OpenProject API token, view a calendar with Portuguese holidays, and get recommendations for distributing hours across their assigned tasks. Hours can be saved directly to OpenProject via its REST API.

## Project Context

Start reading the `README.md` file to obtain more context about the project.

## Commands

- `npm run dev` — Start dev server (localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint (Next.js core-web-vitals + TypeScript rules)
- `npm start` — Start production server

### Docker Deployment

- `./deploy.sh` (Linux/Mac) or `deploy.bat` (Windows) — Build and deploy via Docker Compose
- Production runs on port **3700** (container name: `website-log-horas`)
- Uses `docker-compose.yml` for production (the `docker-compose.yaml` is a leftover from a different project)

## Architecture

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4

### Frontend (Client-Side)

Single-page app — all UI is client-rendered (`"use client"`).

- `app/page.tsx` — Login screen + main view. Stores credentials in `localStorage`. Owns `timeEntries` state and passes `onTimeEntriesUpdate` callback to Calendar for optimistic updates.
- `components/Calendar/index.tsx` (~775 lines) — Core orchestrator:
  - Sub-components: `DayCell`, `TaskModal`, `ConfirmationModal`, `ClearHoursModal`, `ClearMonthModal`
  - State: `savingDays: Set<string>` tracks which days have active API calls (shown as spinners on DayCell)
  - Optimistic updates via `optimisticAddHours()` / `optimisticClearDay()` — updates `timeEntries` immediately after API success so day colors change before the full reload completes
  - 4 API action functions: `saveRecommendedHours`, `clearHours`, `saveMultipleDays`, `clearMultipleDays`
- `components/QuickHoursForm/` — Smart hour entry form with task selection, history-based pre-fill, active task filtering per day
- `components/WeekFillModal/` — Fill entire week with proportional hour distribution, navigable to any week
- `components/MonthFillModal/` — Fill entire month automatically, week-grid preview with color-coded status
- `components/ScheduleSettings/` — Configurable work schedule UI (Verao/Inverno modes)
- `components/TaskAssignmentModal/` — Pin/unpin tasks to specific calendar days
- `components/Toast/` — Toast notification system (`ToastProvider`, `ToastContainer`, `useToast()` hook). Replaced all `alert()` calls.
- `components/Providers.tsx` — App-level providers (ToastProvider)

### Shared Code

- `types/index.ts` — Centralized TypeScript types (`TodoItem`, `Holiday`, `WorkSchedule`, `TaskAssignment`, `TimeEntriesData`, `SmartRecommendation`, `SprintInfo`, `Toast`, etc.)
- `lib/calendar-utils.ts` — Pure utility functions (`formatHours`, `toKey`, `getHoursStatus`, `getWeekDays`, `formatWeekRange`, constants including `IN_PROGRESS_STATUSES`)
- `lib/holidays.ts` — Portuguese holiday calculation (Easter-based movable + fixed)
- `lib/recommendations.ts` — Smart recommendation engine with scoring (pinned +3, recent history +2, any history +1). Deterministic ±0.5h variation between days.
- `lib/task-filtering.ts` — `isTaskActiveOnDay()` / `getActiveTasksForDay()` using `activeFrom`/`activeUntil` date ranges
- `hooks/useWorkSchedule.ts` — Configurable work schedule hook (persisted in localStorage)
- `hooks/useTaskAssignments.ts` — Task-to-day pinning hook (persisted in localStorage)

### Backend (API Routes)

All routes proxy to an external OpenProject instance. Auth: frontend sends `Authorization: Basic <base64(apikey:token)>` + `X-OpenProject-URL` header. Routes forward auth directly (do NOT re-encode).

- `POST /api/openproject/verify-token` — Validates token, fetches user info, open work packages (with sprint/version data), time entries aggregated into `byDay`/`byTask`/`byDayTask`, activity history per task for `activeFrom`/`activeUntil` dates, and sprint date ranges.
- `GET /api/openproject/get-task?taskId=X` — Fetches a single work package by ID. Auth header passed through directly.
- `POST /api/openproject/add-time-entries` — Creates time entries (converts decimal hours to ISO 8601 duration `PTxHyM`).
- `POST /api/openproject/clear-time-entries` — Deletes time entries for a date. Scoped to current user via `/users/me` lookup. Returns `{ deleted, permissionErrors }`. Paginates through all entries.

### Key Domain Logic

- **Work schedule:** Configurable via ScheduleSettings. Default: Summer (Apr-Aug) Mon-Thu=7h, Fri=9h; Winter (Sep-Mar) all weekdays=9h. Persisted in localStorage.
- **Hour recommendations:** Smart scoring (pinned +3, recent history +2, any history +1). Pre-fills from historical average. Deterministic hour variation (±0.5h) between days to avoid monotony. `TimeEntriesData` has `byDay`, `byTask` (with `avgHoursPerDay`), and `byDayTask` aggregations.
- **Task filtering by day:** Each task has `activeFrom`/`activeUntil` dates derived from activity history. Only tasks active on a given day appear in recommendations for that day.
- **Meetings task:** Always included in recommendations (configurable task ID, default 5158, stored in localStorage as `meetings_task_id`).
- **Task assignment (pinning):** Tasks can be pinned to specific days via TaskAssignmentModal. Pinned tasks get priority in recommendations.
- **Sprint filtering:** Dropdown auto-detects sprint with most tasks. Tasks filtered by sprint. Sprint date ranges shown on calendar (ring border on days within sprint period).
- **Optimistic updates:** After API success, `timeEntries` state is updated immediately via `onTimeEntriesUpdate` callback from `page.tsx`. `onMonthChange` still fires for full server refresh, but UI updates colors instantly.
- **Loading indicators:** `savingDays: Set<string>` tracks active API calls. `DayCell` shows spinner overlay + disables click for days being saved/cleared. Bulk operations remove each day's spinner as it completes.

### localStorage Keys

| Key | Content |
|-----|---------|
| `openproject_token` | API token |
| `openproject_url` | OpenProject base URL |
| `openproject_user` | User info JSON |
| `meetings_task_id` | Meetings task work package ID (default: "5158") |
| `active_sprint` | Selected sprint name |
| `work_schedule` | Custom work schedule config (JSON) |
| `task_assignments` | Pinned task-to-day mappings (JSON) |

## Language

The UI is in **Portuguese**. Variable names and code are in English.

## Plans

The `plans/` folder contains implementation plans (001-007). When making significant changes, document the plan in `plans/NNN-description.md` for context in future sessions.

## Known Gotchas

- **Auth encoding:** Frontend sends pre-encoded `Basic` auth. Backend routes MUST NOT re-encode (double-encoding was a past bug in `get-task`). The `get-task` route passes the `Authorization` header through directly.
- **clear-time-entries user scoping:** Must filter by user ID (fetched via `/users/me`), otherwise it picks up other users' entries and gets 403s.
- **OpenProject API pagination:** `verify-token` fetches up to 1000 entries. `clear-time-entries` paginates with `pageSize=100`.
- **Status filtering:** API uses `status: "o"` (open only). `IN_PROGRESS_STATUSES` in `calendar-utils.ts` defines which statuses appear in recommendations.

## After Changes

After every change to the code **YOU MUST** change the README.md file to contain the changelog that was made during the claude session.
