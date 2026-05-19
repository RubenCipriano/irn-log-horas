import type { StatusSegment, StatusWeightConfig, TaskStatusTimeline, TimelineInferenceConfig } from "@/types";

// Status weights drive both inclusion (score) and how much of the daily hour budget
// a task gets on a given day. 1.0 = full hours, 0 = excluded.
// Keys are lowercase status names (matched by substring against the actual status).
//
// IRN workflow note: only "fechado"/"closed" is truly terminal. "Desenvolvido"
// means "OK in DEV" but the task may still need touch-ups, QLD round-trip, or
// bug fixes — so it stays eligible for hours at a mid-low weight.
export const DEFAULT_STATUS_WEIGHTS: StatusWeightConfig = {
  "em desenvolvimento": 1.0,
  "in development": 1.0,
  "in progress": 1.0,
  "em curso": 1.0,
  "em execucao": 1.0,
  "a desenvolver": 0.8,
  "mr em dev": 0.4,
  "mr em qa": 0.4,
  "em teste": 0.3,
  "em testes": 0.3,
  "em qa": 0.3,
  "testing": 0.3,
  "desenvolvido": 0.3,
  "developed": 0.3,
  "novo": 0.2,
  "new": 0.2,
  "on hold": 0.1,
  "onhold": 0.1,
  "bloqueado": 0.1,
  "rejeitado": 0.1,
  "rejected": 0.1,
  "fechado": 0.0,
  "closed": 0.0,
};

// Resolve the weight for a status string by checking substring matches against the config.
// Returns the most specific match (longest matching key), defaulting to 0.5 if unknown
// so brand-new status names get a moderate weight rather than being silently excluded.
export function resolveStatusWeight(status: string | null | undefined, weights: StatusWeightConfig): number {
  if (!status) return 0.5;
  const lower = status.toLowerCase().trim();
  if (weights[lower] !== undefined) return weights[lower];

  let bestKey: string | null = null;
  for (const key of Object.keys(weights)) {
    if (lower.includes(key) && (bestKey === null || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  return bestKey !== null ? weights[bestKey] : 0.5;
}

export function getStatusOnDay(timeline: TaskStatusTimeline | undefined, dayKey: string): StatusSegment | null {
  if (!timeline?.segments?.length) return null;
  for (const seg of timeline.segments) {
    const inRange = seg.fromDate <= dayKey && (seg.toDate === null || dayKey <= seg.toDate);
    if (inRange) return seg;
  }
  return null;
}

export function getStatusWeightForDay(
  timeline: TaskStatusTimeline | undefined,
  dayKey: string,
  weights: StatusWeightConfig,
): number {
  const seg = getStatusOnDay(timeline, dayKey);
  if (!seg) return 0.5; // no timeline available — neutral weight
  return resolveStatusWeight(seg.statusLower, weights);
}

export function getActiveDaysInRange(
  timeline: TaskStatusTimeline | undefined,
  from: string,
  to: string,
  weights: StatusWeightConfig,
): { dayKey: string; weight: number; status: string }[] {
  if (!timeline?.segments?.length) return [];
  const out: { dayKey: string; weight: number; status: string }[] = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayKey = d.toISOString().slice(0, 10);
    const seg = getStatusOnDay(timeline, dayKey);
    if (!seg) continue;
    const weight = resolveStatusWeight(seg.statusLower, weights);
    if (weight > 0) out.push({ dayKey, weight, status: seg.status });
  }
  return out;
}

// Derive activeFrom/activeUntil for back-compat with code that reads them directly.
// activeFrom = first day the task had a non-zero weight.
// activeUntil = last day before a permanent terminal segment (weight 0); null if still active.
export function deriveActiveBounds(
  timeline: TaskStatusTimeline,
  weights: StatusWeightConfig,
): { activeFrom: string | null; activeUntil: string | null } {
  if (!timeline.segments.length) return { activeFrom: null, activeUntil: null };

  let activeFrom: string | null = null;
  for (const seg of timeline.segments) {
    if (resolveStatusWeight(seg.statusLower, weights) > 0) {
      activeFrom = seg.fromDate;
      break;
    }
  }
  if (activeFrom === null) {
    // Task never had a working status (e.g. only "novo" with weight 0 in custom config)
    // Fall back to the first segment so it still appears somewhere.
    activeFrom = timeline.segments[0].fromDate;
  }

  // activeUntil: if the last segment is open-ended and has weight 0, the task was closed;
  // use its fromDate − 1 as upper bound. If open-ended with weight > 0, still active.
  const last = timeline.segments[timeline.segments.length - 1];
  if (last.toDate === null) {
    if (resolveStatusWeight(last.statusLower, weights) === 0) {
      return { activeFrom, activeUntil: shiftDay(last.fromDate, -1) };
    }
    return { activeFrom, activeUntil: null };
  }
  // Last segment is closed — task was archived at last.toDate
  return { activeFrom, activeUntil: last.toDate };
}

export function shiftDay(dayKey: string, deltaDays: number): string {
  const d = new Date(dayKey + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Collect every unique lowercase status seen across a set of timelines.
// Used by StatusWeightSettings to render one slider per detected status.
export function collectDetectedStatuses(timelines: Record<string, TaskStatusTimeline>): string[] {
  const seen = new Set<string>();
  for (const tl of Object.values(timelines)) {
    for (const seg of tl.segments) seen.add(seg.statusLower);
  }
  return Array.from(seen).sort();
}

function matchesAny(statusLower: string, list: string[]): boolean {
  return list.some(s => statusLower === s || statusLower.includes(s));
}

// When the activity history skips an active-development state (e.g. goes from
// "Novo" straight to "Desenvolvido"), insert a synthetic segment of `fillState`
// in the gap, marked as `inferred: true`. The AI prompt uses this flag to know
// it should ask the user what was done.
export function inferGaps(segments: StatusSegment[], config: TimelineInferenceConfig): StatusSegment[] {
  if (!config.enabled || segments.length < 2) return segments;

  const out: StatusSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    out.push(cur);
    const next = segments[i + 1];
    if (!next) continue;

    const curIsStarter = matchesAny(cur.statusLower, config.starterStates);
    const nextIsTerminal = matchesAny(next.statusLower, config.terminalStates);
    if (!curIsStarter || !nextIsTerminal) continue;

    const gapFrom = cur.toDate ? shiftDay(cur.toDate, 1) : null;
    const gapTo = shiftDay(next.fromDate, -1);
    if (!gapFrom || gapFrom > gapTo) continue;

    out.push({
      status: config.fillState,
      statusLower: config.fillState.toLowerCase(),
      fromDate: gapFrom,
      toDate: gapTo,
      inferred: true,
    });
  }
  return out;
}
