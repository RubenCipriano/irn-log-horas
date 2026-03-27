# 007 - Loading State per Day (Visual Feedback for Save/Clear Operations)

## Problem

When saving or clearing hours, the user has no visual indication of **which days** are being processed. The only feedback is:
- Modal buttons show "Guardando..." / "Apagando..." text
- A toast appears after completion

For single-day operations this is acceptable, but for bulk operations (`saveMultipleDays` in WeekFillModal/MonthFillModal), the user sees nothing on the calendar while days are being processed one by one.

## Goal

Show a per-day loading indicator on the calendar `DayCell` so the user can see which day(s) are currently being saved/cleared.

## Current State

- `isSavingHours` (boolean) — global flag, no per-day granularity
- `clearWeekProgress` (`{ current, total }`) — exists for ClearWeekModal but not surfaced on DayCells
- `DayCell` has no `isLoading` or `isSaving` prop
- `saveMultipleDays()` loops sequentially through days — natural place to track current day
- `saveRecommendedHours()` saves one day — simpler case
- `clearHours()` clears one day — simpler case

## Implementation Plan

### Step 1: Add `savingDays` state to Calendar

In `components/Calendar/index.tsx`:

```typescript
const [savingDays, setSavingDays] = useState<Set<string>>(new Set());
```

This tracks which day keys (e.g. "2026-03-27") are currently being processed (save or clear).

### Step 2: Update save/clear functions to track active days

**`saveRecommendedHours()`:**
- Before API call: `setSavingDays(new Set([toKey(selectedDate)]))`
- In finally block: `setSavingDays(new Set())`

**`clearHours()`:**
- Before API call: `setSavingDays(new Set([toKey(dateToDelete)]))`
- In finally block: `setSavingDays(new Set())`

**`saveMultipleDays()`:**
- Before loop: `setSavingDays(new Set(dayEntries.map(e => toKey(e.date))))`
- After each day completes: remove that day from the set
- In finally block: `setSavingDays(new Set())`

**`clearMultipleDays()` (ClearWeekModal flow):**
- Same pattern as `saveMultipleDays` — add all selected days, remove each as completed

### Step 3: Add `isSaving` prop to DayCell

In `components/Calendar/DayCell.tsx`:

```typescript
type DayCellProps = {
  // ... existing props
  isSaving?: boolean;
};
```

### Step 4: Visual indicator on DayCell

When `isSaving` is true, show:
- A subtle pulsing/spinning overlay on the cell
- Reduce opacity of cell content slightly (opacity-60)
- A small spinner icon (CSS-only, no library needed) in the top-right corner
- Disable click interactions while saving

Design: animated border pulse (indigo) + small CSS spinner, keeping it lightweight and consistent with the existing Tailwind styling.

```tsx
{isSaving && (
  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/50 dark:bg-slate-900/50">
    <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
  </div>
)}
```

### Step 5: Pass `isSaving` from Calendar grid to DayCell

In the calendar grid render loop:

```tsx
<DayCell
  // ... existing props
  isSaving={savingDays.has(key)}
/>
```

### Step 6: Bulk operation progress — days turn green as they complete

For `saveMultipleDays`, as each day completes successfully:
1. Remove day from `savingDays`
2. The `onMonthChange()` refresh at the end will update colors, but that happens after ALL days
3. **Enhancement:** call `onMonthChange()` could be too heavy per-day. Instead, just removing from `savingDays` is sufficient — the spinner disappears, giving visual feedback of progress. After all days complete, the full refresh updates colors to green.

### Files Changed

| File | Change |
|------|--------|
| `components/Calendar/index.tsx` | Add `savingDays` state, update save/clear functions |
| `components/Calendar/DayCell.tsx` | Add `isSaving` prop, render spinner overlay |
| `types/index.ts` | No changes needed (state is local to Calendar) |

### Scope

- Small change: ~30 lines across 2 files
- No new dependencies
- Pure visual enhancement, no logic changes to save/clear operations
- CSS-only spinner (Tailwind `animate-spin`)
