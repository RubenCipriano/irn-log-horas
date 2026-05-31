# Plan 015 — Org-configurable timesheet (schedule + holidays + filters)

**Created**: 2026-05-25
**Depends on**: Plan 009 (org-context), Plan 010-B (calendar)
**Status**: In progress.

> The cloud calendar today hardcodes a single PT-IRN summer/winter schedule (`DEFAULT_SCHEDULE` from `@timeflow/domain`) and Portuguese national holidays. That's correct for one customer. For the cloud to sell across countries and municipalities ("Lisboa, Leiria, Loures times etc."), every timesheet input needs to be a per-org policy: working schedule, regional holidays, and the calendar's filter window.

---

## 1. Why this slice exists

User feedback during live test, paraphrased: *"The 9h/7h shown in the corner should be configurable. Some companies use 7h Mon-Thu + 9h Fri; some use 8h every day; some want different periods (summer/winter). Holidays should be Lisboa-specific or Leiria-specific, not just national. I want to sell to many countries — everything must be configurable."*

The right abstraction: an **org policy** the Owner sets once. The calendar + recommendation engine + capacity views all read from it. Defaults stay sensible (PT-IRN compatible — what cloud's first customer has) so existing data isn't broken, but every org can override.

Three pillars:

1. **Schedule periods** — an ordered list of `{ from, to, hours-per-weekday }` rules that apply annually. Last-wins on overlap. Each org defines its own.
2. **Holiday profile** — a preset key (e.g. `pt-national`, `pt-lisboa`, `es-national`, `us-federal`) + a manual `additions` list + an `exclusions` list. Presets ship in `@timeflow/domain`; orgs combine them.
3. **Filter knobs** — the recently-active 60-day window from plan 013, status weight overrides, sprint mode toggle. Stretch goal for this slice — schedule + holidays are the priority.

The framework is the deliverable. The country coverage is incremental — we can ship PT + ES + US + UK + BR presets in this slice and add others later without schema changes.

---

## 2. Scope

### In scope (this slice)

**Schema:**
- `organisations.scheduleConfig` (JSONB nullable) — the period rules. Null → use the built-in default (today's behaviour).
- `organisations.holidayProfile` (JSONB nullable) — `{ preset, additions, exclusions }`. Null → PT national (today's behaviour).

**`@timeflow/domain` subsystem split** (per user's "more packages / hooks / smaller files" request):
- `packages/domain/src/schedule/types.ts` — `OrgScheduleConfig`, `SchedulePeriod`, etc.
- `packages/domain/src/schedule/evaluate.ts` — `resolveExpectedHours(date, config)` returns the hours for that specific date by walking the period list.
- `packages/domain/src/schedule/presets.ts` — `PT_IRN_SCHEDULE`, `EIGHT_HOURS_FIXED`, etc.
- `packages/domain/src/holidays/types.ts` — `OrgHolidayProfile`, holiday descriptor types.
- `packages/domain/src/holidays/presets/{portugal,spain,united-states,united-kingdom,brazil}.ts` — per-country files, each exporting national + regional preset entries.
- `packages/domain/src/holidays/registry.ts` — preset lookup + `resolveHolidaysForProfile(profile, year)` composition.
- Old `packages/domain/src/holidays.ts` becomes a thin shim that delegates to the registry (keeps the existing `getPortugalHolidays`, `getPortugueseHoliday` exports working).

**Cloud helpers:**
- `apps/cloud/lib/org-policy.ts` — `readOrgPolicy(orgId)` returns the merged `{ scheduleConfig, holidayProfile }` (filling defaults), `updateOrgPolicy(orgId, patch)` validates + persists.
- `apps/cloud/lib/calendar-deps.ts` — small adapter so the calendar page doesn't import schedule logic directly; gives one cleanup target for plan 014's DX refactor.

**API:**
- `PATCH /api/orgs/[id]/policy` — owner-only (`requireOrgRole(orgId, "owner")`), validates the JSON shape, persists, audits.

**Admin UI** at `/settings/org-policy`:
- Server page gates on `org.delete` (Owner-only — schedule + holidays are policy decisions; admins can still see other settings but not change these).
- Schedule editor: list of periods, each editable with from/to (MM-DD picker) + per-weekday hour inputs. Add/remove periods. Drag-reorder later — for now last-in-list wins.
- Holiday editor: preset dropdown (lists everything `@timeflow/domain` knows). Below it: a list of additions (date + name) the user can append, and exclusions chips (preset holidays to skip).

**Calendar:**
- Calendar page calls `readOrgPolicy` once. Both the per-day `expectedHours` pre-compute and the holiday lookup now use the org's config instead of `DEFAULT_SCHEDULE` / `getPortugueseHoliday`.

### Explicitly out of scope (next slice)

- Per-user schedule override (user has a 50% contract). User-preferences extension is straightforward; deferred so this slice stays focused on the org-policy primitives.
- Time-of-day work windows ("9:00-17:00" vs total-hours) — adds a lot of UI complexity for marginal value.
- Different schedules per team/squad — squad already exists in the schema; this is a follow-up wiring slice.
- Status weight overrides UI — exists in the `@timeflow/domain` data model but the cloud doesn't have a UI for it yet.
- Per-user timezone-respectful date math (UTC drift on the boundary). Today the calendar uses local-TZ for the dayKey; matches OSS. Multi-TZ orgs need a thoughtful pass.
- Recently-active filter as a configurable knob.
- Day-detail parity polish (status pip per task in cell, activity timeline strip in modal, status change action). Deferred to plan 016 — user requested it explicitly but it's a separate UI slice that doesn't gate this one.

---

## 3. Security checks

| Check | Where |
|---|---|
| `PATCH /api/orgs/[id]/policy` gates on `requireOrgRole(orgId, "owner")` — policy changes affect EVERY user in the org | endpoint |
| JSON validated against a schema before persisting — malformed `scheduleConfig` could blank the calendar for every user | endpoint |
| Per-period weekday hours capped at [0, 24] each, periods capped at 20 per org (DoS prevention) | endpoint validation |
| Preset key validated against the registry — unknown keys fall back to "none" rather than crashing | resolver |
| Audit action `org.policy_changed` with diff = `{ before, after }` for both schedule and holiday | endpoint |
| Owner-only sub-rule defended in depth in the UI page (server-side gate), not just hidden via CSS | page.tsx |
| Reads cached at the request scope only — policy changes show up on the next page load, not 60 minutes later | no cache layer on `readOrgPolicy` for now; revisit when load testing |

---

## 4. Implementation order

1. Schema migration (`scheduleConfig`, `holidayProfile` columns).
2. `@timeflow/domain/schedule` subsystem.
3. `@timeflow/domain/holidays/presets/{portugal,spain,united-states,united-kingdom,brazil}` + registry.
4. Backwards-compat shim on `holidays.ts` so existing callers still compile.
5. `lib/org-policy.ts` in cloud.
6. PATCH endpoint + new audit action `org.policy_changed`.
7. `/settings/org-policy` admin UI (schedule editor + holiday picker).
8. Calendar page reads org policy.
9. AppNav "Org policy" link under Settings (Owner-only).

---

## 5. Estimated effort

- §4.1 schema: 0.5h
- §4.2 schedule subsystem: 1.5h
- §4.3 holiday presets + registry: 2h
- §4.4 shim: 0.25h
- §4.5 org-policy lib: 0.75h
- §4.6 PATCH endpoint: 1h
- §4.7 admin UI: 2h
- §4.8 calendar integration: 0.5h
- §4.9 nav link: 0.25h

**Total: ~9h.** Probably 1.5 sessions; this plan covers the framework + PT + ES + US + UK + BR presets.

---

## 6. Acceptance criteria

- [ ] Owner can change Mon-Thu / Fri hours and the calendar reflects the new expected hours.
- [ ] Owner can add a schedule period (e.g. "Jun–Sep" with different hours) and the calendar shows the period-specific hours within that range.
- [ ] Owner can pick a holiday preset (e.g. `pt-lisboa`) and the calendar shows the Lisboa municipal holiday on the right day.
- [ ] Owner can add a custom holiday ("Company off-day") and the calendar shows it.
- [ ] Owner can exclude a preset holiday and the calendar drops it.
- [ ] Other roles (Admin / Manager) see the org-policy page in read-only or not at all (Owner-only edit).
- [ ] Audit captures each policy change.
- [ ] Existing orgs with no `scheduleConfig` set keep working unchanged (default is the legacy PT-IRN summer/winter schedule).

---

## 7. Follow-up plans

- **Plan 016** — Day-detail parity with apps/web (status pip per task in cells, activity timeline strip in modal, status change action) — the user explicitly asked for this; carving it as a separate slice keeps the diffs reviewable.
- **Plan 017** — Per-user schedule override on top of org schedule (50% contracts, half-day fridays per individual).
- **Plan 018** — Squad-level schedule overrides for orgs that span teams in different timezones / countries.
- **Plan 019** — Customer-facing region picker on `/onboarding/create-org` so new orgs land on the right defaults.
- **Plan 014** — DX refactor sketched in plan 013 §5 (hooks, Modal primitive, file splits) — execute once 015 + 016 settle.
