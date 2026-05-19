# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**website-log-horas** — Next.js 16 web app for logging work hours to an OpenProject instance (IRN — Instituto dos Registos e do Notariado). Users authenticate with an OpenProject API token, see a calendar with Portuguese holidays, and get **activity-aware** hour recommendations driven by each task's status timeline. Hours save directly to OpenProject. A pluggable AI assistant turns natural-language descriptions ("trabalhei nos Documentos Compostos") into a draft distribution the user can review and accept.

Always start by reading `README.md` for the user-facing changelog.

## Commands

- `npm run dev` — Dev server (localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint (Next.js core-web-vitals + TS rules)
- `npm start` — Production server
- `./deploy.sh` / `deploy.bat` — Docker Compose deploy (port **3700**, container `website-log-horas`)

## Architecture

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Fuse.js (fuzzy task matching).

### Layout shell

The app runs inside an `AppShell` (`components/Layout/AppShell.tsx`):
- **Left sidebar** ([components/Layout/Sidebar.tsx](components/Layout/Sidebar.tsx)) — user info, sprint filter, searchable task list, logout. Collapsible.
- **Top bar** ([components/Layout/TopBar.tsx](components/Layout/TopBar.tsx)) — month nav, today, week/month fill, clear, command-palette trigger, reload, settings cog.
- **Main content** — calendar grid via `Calendar` orchestrator.
- **Right drawer** ([components/Layout/SettingsDrawer.tsx](components/Layout/SettingsDrawer.tsx)) — tabs: Horario, Pesos, IA, Meetings.
- **Command palette** ([components/CommandPalette/index.tsx](components/CommandPalette/index.tsx)) — `Ctrl+K` / `Cmd+K`. Submits to the AI flow.

### Calendar orchestrator

[components/Calendar/index.tsx](components/Calendar/index.tsx) owns the month grid, modal state, API actions, and the AI flow (`handlePaletteSubmit` → `/api/ai/distribute` → `AIPreviewModal` → `saveMultipleDays`).

Sub-components live under `components/Calendar/`:
- `DayCell.tsx` — animated status colors, per-task **status pip** (color reflects day-weight from the timeline), hover toolbar, sprint ring.
- `TaskModal.tsx` — task details with embedded `ActivityTimelineStrip` (visualises the full status history).
- `ConfirmationModal.tsx`, `ClearHoursModal.tsx`, `ClearMonthModal.tsx` — kept from previous design.

### Status timeline data layer

[app/api/openproject/verify-token/route.ts](app/api/openproject/verify-token/route.ts) is the entry point. For each task it:
1. Fetches `/api/v3/work_packages/{id}/activities` in parallel.
2. Extracts every status transition via **three fallbacks** — structured `details`, PT regex (`situacao alterado de X para Y`), EN regex (`status changed from X to Y`). **Do not remove any of these** — they handle real OpenProject quirks.
3. Calls `buildTimeline()` to produce a `TaskStatusTimeline` with non-overlapping segments (`{status, statusLower, fromDate, toDate|null}`).
4. Calls `deriveActiveBounds(timeline, DEFAULT_STATUS_WEIGHTS)` to populate `activeFrom`/`activeUntil` for back-compat — old code that reads those fields keeps working.

Pure helpers live in [lib/status-timeline.ts](lib/status-timeline.ts):
- `DEFAULT_STATUS_WEIGHTS` — keys are lowercase status names, values are weights in `[0, 1]`. `em desenvolvimento = 1.0`, review states = `0.4`, terminal/blocked = `0.0`.
- `getStatusOnDay`, `getStatusWeightForDay`, `getActiveDaysInRange`, `deriveActiveBounds`, `resolveStatusWeight`, `collectDetectedStatuses`.

### Unified recommendation engine

[lib/recommendations.ts](lib/recommendations.ts) — single function `calculateSmartRecommendations` that merges all signals into one score:

| Signal                                  | Score |
|-----------------------------------------|-------|
| Pinned to this day                      | +3    |
| `dayWeight >= 0.5` (active dev)         | +4    |
| `0.1 <= dayWeight < 0.5` (review/QA)    | +2    |
| `dayWeight === 0` with a timeline       | -5 (excluded) |
| Used in last 7 days (history)           | +2    |
| Used in last 30 days (history)          | +1    |

Hours are then scaled by `max(dayWeight, 0.2)` before the existing iterative scale-to-fill loop (preserved — **do not modify**; it is what guarantees the daily total equals exactly `expectedHours - alreadyRegistered`).

### Pluggable AI

All adapters live under [lib/ai/](lib/ai/) and use plain `fetch` — no vendor SDKs.

- `provider.ts` — `AIProvider` interface with single `chat(messages, opts)` method
- `gemini.ts` — Google Gemini Flash-Lite via `generativelanguage.googleapis.com`
- `groq.ts` — Groq (`llama-3.3-70b-versatile`)
- `ollama.ts` — Local Ollama at user-supplied URL
- `openrouter.ts` — OpenRouter (free + paid models, OpenAI-compatible API)
- `openai-compat.ts` — Generic OpenAI-compatible endpoint (LM Studio, vLLM, Together, Mistral, etc.)
- `factory.ts` — `getProvider(config)` dispatcher
- `matcher.ts` — Fuse.js fuzzy match, accent-stripped, threshold 0.5
- `prompt.ts` — Portuguese system prompt + JSON validator (`parseDistributeResponse`); also merges in `gitlabActivity` + `gitlabBaseline` context
- `distribute.ts` — orchestrator: fuzzy match → top-N tasks → optional GitLab baseline → LLM call → validate → merge

### GitLab integration

- [lib/gitlab/client.ts](lib/gitlab/client.ts) — fetches recent commits (`/events?action=pushed`) and MRs (`/merge_requests?scope=created_by_me`). `extractTaskIds(text)` regex maps `#32195`, `wp-32195`, or bare 4-6 digit numbers to OpenProject task IDs.
- [app/api/gitlab/activity/route.ts](app/api/gitlab/activity/route.ts) — proxy. Token in request body per-call, never persisted server-side.
- [hooks/useGitLabConfig.ts](hooks/useGitLabConfig.ts) — localStorage `gitlab_config_v1`.
- ID-matched activity becomes baseline `DistributionItem`s with `source: "gitlab"`. Un-matched activity is passed as context to the LLM prompt.

### Timeline inference

- [lib/status-timeline.ts](lib/status-timeline.ts) `inferGaps(segments, config)` inserts a synthetic `inferred: true` segment between a starter state (Novo) and a terminal state (Desenvolvido) when OpenProject didn't record the active-dev period.
- Configurable per-user via [hooks/useTimelineInference.ts](hooks/useTimelineInference.ts) (localStorage `timeline_inference_v1`); UI in [components/TimelineInferenceSettings/index.tsx](components/TimelineInferenceSettings/index.tsx).
- The inference config is forwarded by `app/page.tsx` in the `verify-token` POST body so the server applies it consistently.
- `ActivityTimelineStrip` renders inferred segments with diagonal stripes and a click handler that opens the command palette pre-filled with a confirmation prompt.
- The AI prompt's serialised segments include `inferred: true` so the LLM knows to ask or propose conservatively.

Server route [app/api/ai/distribute/route.ts](app/api/ai/distribute/route.ts) receives `{description, dateRange, tasks, weights, schedule, providerConfig}` and returns `{items, warnings}`. **Provider config (including API key) travels per-request; never persisted server-side, never logged.**

Client-side state lives in [hooks/useAIProvider.ts](hooks/useAIProvider.ts) (localStorage `ai_provider_config_v1`). Configured via [components/AISettings/index.tsx](components/AISettings/index.tsx) in the settings drawer.

The AI flow:
1. User opens command palette (`Ctrl+K`) and types description.
2. Palette POSTs to `/api/ai/distribute` with the user's provider config.
3. Response opens [components/AIPreviewModal/index.tsx](components/AIPreviewModal/index.tsx) — editable per-day, per-task, per-hour preview.
4. "Aceitar e guardar" groups items by day and calls existing `/api/openproject/add-time-entries` once per day.

### Other domain logic (unchanged)

- **Work schedule**: configurable Verao/Inverno via [hooks/useWorkSchedule.ts](hooks/useWorkSchedule.ts) + [components/ScheduleSettings/index.tsx](components/ScheduleSettings/index.tsx). Default: Summer Mon-Thu=7h, Fri=9h; Winter all=9h.
- **Task pinning**: [hooks/useTaskAssignments.ts](hooks/useTaskAssignments.ts) — manual `taskId → dayKey` map.
- **Meetings task**: always included with 0.5h placeholder. Configurable in settings drawer ("Meetings" tab).
- **Sprint filtering**: dropdown auto-detects sprint with most tasks. Sprint date ranges drawn as indigo ring on calendar days.
- **Optimistic updates**: `optimisticAddHours` / `optimisticClearDay` update `timeEntries` immediately after a successful API call. `onMonthChange` still fires for full server refresh.
- **Loading indicators**: `savingDays: Set<string>` per-day spinners during save/clear; skeleton cells during initial month load.
- **Toasts**: `components/Toast/*` — auto-dismiss 4s, top-right.

## Keyboard shortcuts

[hooks/useKeyboardShortcuts.ts](hooks/useKeyboardShortcuts.ts) installs a single `window` listener. Shortcuts:

| Keys | Action |
|------|--------|
| `Ctrl/Cmd+K` | Command palette (AI) |
| `←` / `→` | Previous / next month |
| `T` | Jump to today |
| `W` | Open week fill |
| `M` | Open month fill |
| `S` | Open settings drawer |
| `Esc` | Close topmost modal |

All except `Ctrl+K` and `Esc` are suppressed when focus is inside an `<input>`, `<textarea>`, `<select>`, or `[contenteditable]`.

## localStorage keys

| Key | Content |
|-----|---------|
| `openproject_token` | API token |
| `openproject_url` | OpenProject base URL |
| `openproject_user` | User info JSON |
| `meetings_task_id` | Meetings work package ID (default `5158`) |
| `active_sprint` | Selected sprint name |
| `work_schedule` | Custom work schedule (JSON) |
| `task_assignments` | Pinned task → day map (JSON) |
| `status_weights_v1` | User overrides for status weights (JSON) |
| `ai_provider_config_v1` | AI provider + API key (JSON, **client-only**) |
| `gitlab_config_v1` | GitLab base URL + PAT (JSON, **client-only**) |
| `timeline_inference_v1` | Timeline inference rules (starter/terminal states, fill state) |
| `theme_v1` | Theme preference (`light` / `dark` / `system`) |

## Design tokens

[app/globals.css](app/globals.css) defines CSS variables consumed via Tailwind 4 inline theme:
- Surfaces: `--surface-1` (cards), `--surface-2` (page bg), `--surface-3` (recessed)
- Text: `--text-1`, `--text-2`, `--text-3`
- Accents: `--accent`, `--success`, `--warn`, `--danger`
- Animations: `fade-in`, `slide-in-right`, `slide-up`, `pulse-soft`, `toast-enter`

## Language

UI in **Portuguese**. Variable names and code in **English**.

## Known gotchas

- **Auth pass-through**: `/api/openproject/get-task` MUST forward the `Authorization` header verbatim (don't re-encode).
- **clear-time-entries scoping**: must filter by current user via `/users/me`, else fetches other users' entries and 403s.
- **Status parse fallbacks**: three paths in `verify-token` (structured, PT, EN). All three must stay.
- **`activeFrom`/`activeUntil` contract**: keep populating these from the timeline so `lib/task-filtering.ts` keeps working untouched.
- **Iterative gap-fix loop** in `recommendations.ts`: do not modify — it guarantees daily totals match `expectedHours` exactly.
- **AI keys never hit the server log**: `app/api/ai/distribute/route.ts` forwards the key to the LLM endpoint and discards it. Don't add request logging.
- **No LLM SDKs**: Gemini / Groq / Ollama are all called via `fetch`. Don't add vendor dependencies.

## Plans

The `plans/` folder contains historical implementation plans (001–007 + the current activity-aware redesign).

## After changes

After every code change in a Claude session, **update `README.md` with a changelog entry** describing the session's work.
