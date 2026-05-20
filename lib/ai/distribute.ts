import type { TodoItem, TaskStatusTimeline, StatusWeightConfig, WorkSchedule, AIAction, AIDistributionItem, AIProviderConfig, GitLabActivity, AvailableStatus } from "@/types";
import { getProvider } from "./factory";
import { matchTasks } from "./matcher";
import { buildDistributePrompt, parseDistributeResponse, promptStats } from "./prompt";
import { expectedHoursForDayKey } from "@/lib/work-schedule";

// JSON schema describing the LLM's expected output. Providers that support
// structured output enforce this client-side; others fall back to jsonMode.
// The new shape uses `actions[]` with a kind discriminator. Older prompts that
// still emit `items[]` are accepted by the parser for one release.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["log_hours", "update_status"] },
          taskId: { type: "string" },
          dayKey: { type: "string" },
          hours: { type: "number" },
          toStatusId: { type: "string" },
          toStatusName: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["kind", "taskId"],
      },
    },
  },
  required: ["reasoning", "actions"],
} as const;

export type DistributeInput = {
  description: string;
  dateRange: { from: string; to: string };
  tasks: (Pick<TodoItem, "id" | "title" | "status" | "statusId"> & { timeline?: TaskStatusTimeline })[];
  weights: StatusWeightConfig;
  schedule: WorkSchedule;
  providerConfig: AIProviderConfig;
  gitlabActivity?: GitLabActivity[];
  timeEntriesData?: Record<string, number>;
  meetings?: { taskId: string; taskTitle: string; hours: number };
  availableStatuses?: AvailableStatus[];
  signal?: AbortSignal;
};

// Build a baseline set of distribution items from GitLab activity. Two paths:
// (a) Exact match by refId (e.g. "#32195" in commit title → task 32195)
// (b) Fuzzy fallback: match commit/MR title against task titles via Fuse.js when no refId is present.
function baselineFromGitLab(
  activities: GitLabActivity[],
  taskIndex: Map<string, { id: string; title: string }>,
  allTasks: TodoItem[],
  range: { from: string; to: string },
): { items: AIDistributionItem[]; summary: { commits: number; mrs: number; matchedById: number; matchedByFuzzy: number; unmatched: number }; unmatchedActivities: GitLabActivity[] } {
  const out: AIDistributionItem[] = [];
  const unmatchedActivities: GitLabActivity[] = [];
  let commits = 0, mrs = 0, matchedById = 0, matchedByFuzzy = 0, unmatched = 0;

  for (const act of activities) {
    if (act.type === "commit") commits++;
    else if (act.type === "merge_request") mrs++;

    const dayKey = act.createdAt.split("T")[0];
    if (dayKey < range.from || dayKey > range.to) continue;
    const defaultHours = act.type === "merge_request" ? 2 : 1;

    // Path (a): exact ID match
    let matched = false;
    for (const refId of act.refIds) {
      const task = taskIndex.get(refId);
      if (!task) continue;
      matched = true;
      out.push({
        taskId: task.id,
        taskTitle: task.title,
        dayKey,
        hours: defaultHours,
        reason: act.type === "merge_request" ? `MR: ${act.title.slice(0, 60)}` : `Commit: ${act.title.slice(0, 60)}`,
        source: "gitlab",
        confidence: 0.85, // #ID match is strong evidence
      });
    }
    if (matched) {
      matchedById++;
      continue;
    }

    // Path (b): fuzzy match commit title to task titles
    const matches = matchTasks(act.title, allTasks);
    const best = matches[0];
    if (best && best.score >= 0.4) {
      matchedByFuzzy++;
      out.push({
        taskId: best.task.id,
        taskTitle: best.task.title,
        dayKey,
        hours: defaultHours,
        reason: act.type === "merge_request"
          ? `MR (fuzzy): ${act.title.slice(0, 50)}`
          : `Commit (fuzzy): ${act.title.slice(0, 50)}`,
        source: "gitlab",
        confidence: 0.55, // title-only match is weaker than #ID
      });
    } else {
      unmatched++;
      // Only surface unmatched activity that's actually inside the date range,
      // so the modal doesn't show out-of-range noise.
      if (dayKey >= range.from && dayKey <= range.to) {
        unmatchedActivities.push(act);
      }
    }
  }

  // Coalesce same (taskId, dayKey) → sum hours, cap 8h.
  const grouped = new Map<string, AIDistributionItem>();
  for (const it of out) {
    const key = `${it.taskId}|${it.dayKey}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.hours = Math.min(8, Math.round((existing.hours + it.hours) * 2) / 2);
      existing.reason = `${existing.reason}; ${it.reason}`.slice(0, 200);
    } else {
      grouped.set(key, { ...it });
    }
  }

  return {
    items: Array.from(grouped.values()),
    summary: { commits, mrs, matchedById, matchedByFuzzy, unmatched },
    unmatchedActivities,
  };
}

export type DistributeResult = {
  // New shape (Phase 12): the full plan including log_hours + update_status.
  actions: AIAction[];
  // Back-compat alias: only the log_hours actions, in the legacy shape used
  // by Phase 1-11 components. Will be removed one release after the modal
  // migrates to `actions`.
  items: AIDistributionItem[];
  warnings: string[];
  reasoning?: string;
  rawResponse?: string;
  gitlabSummary?: {
    commits: number;            // in-range commits
    mrs: number;                // in-range MRs
    matchedById: number;
    matchedByFuzzy: number;
    unmatched: number;
    totalReceived: number;      // count BEFORE range filter
    outOfRange: number;         // totalReceived - inRange
  };
  unmatchedActivities?: GitLabActivity[];
  // Full I/O for debugging: the prompt actually sent + the raw model response.
  // Useful when the AI returns nothing and the user wants to see why.
  debug?: {
    promptSystem: string;
    promptUser: string;
    dateRange: { from: string; to: string };
    tasksSent: number;
    gitlabActivitySent: number;     // count that reached the LLM (post-filter, post-dedup)
    gitlabActivityReceived: number; // count fetched from GitLab (pre-filter)
    gitlabActivityDeduped?: number; // count after (title,date) dedup
    gitlabActivitySummarized?: boolean; // true when listing was swapped for a daily summary
    promptCharCount: number;
    responseCharCount: number;
    retried: boolean;
  };
};

export async function distributeWork(input: DistributeInput): Promise<DistributeResult> {
  const provider = getProvider(input.providerConfig);

  // Defensive: trim GitLab activity to the requested range BEFORE anything else.
  // Even if the client sends pre-filtered data, this guarantees the LLM never sees
  // out-of-range items (which would bias it / waste tokens).
  const totalActivityReceived = input.gitlabActivity?.length || 0;
  const inRangeActivity: GitLabActivity[] = (input.gitlabActivity || []).filter(act => {
    const dayKey = (act.createdAt || "").split("T")[0];
    return dayKey >= input.dateRange.from && dayKey <= input.dateRange.to;
  });
  const outOfRangeCount = totalActivityReceived - inRangeActivity.length;

  // Coerce tasks to TodoItem-shape for the matcher
  const todoItems: TodoItem[] = input.tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    timeline: t.timeline,
    date: null,
  }));

  // Cheap fuzzy match first — used only to RANK the task list, not to filter it.
  // We want the LLM to see every available task so it can pick the best one,
  // especially for vague queries like "verifica os meus commits".
  const matches = matchTasks(input.description, todoItems);
  const top = matches[0];

  // Tasks referenced by in-range GitLab activity (by id or `#ref` in title)
  // MUST survive the 60-task cap, even when the description doesn't fuzzy-match
  // them — otherwise a task the user demonstrably worked on (a commit/MR ref)
  // could be dropped before the LLM ever sees it.
  const gitlabReferencedIds = new Set<string>();
  for (const act of inRangeActivity) {
    for (const ref of act.refIds) {
      const byId = todoItems.find(t => t.id === ref);
      if (byId) { gitlabReferencedIds.add(byId.id); continue; }
      const byTitle = todoItems.find(t => t.title.includes(`#${ref}`));
      if (byTitle) gitlabReferencedIds.add(byTitle.id);
    }
  }

  const matchedSet = new Set(matches.map(m => m.task.id));
  // Order: GitLab-referenced first (guaranteed inclusion), then fuzzy matches,
  // then the rest. Dedupe as we go.
  const seen = new Set<string>();
  const ranked: TodoItem[] = [];
  const pushUnique = (t: TodoItem) => { if (!seen.has(t.id)) { seen.add(t.id); ranked.push(t); } };
  for (const t of todoItems) if (gitlabReferencedIds.has(t.id)) pushUnique(t);
  for (const m of matches) pushUnique(m.task);
  for (const t of todoItems) if (!matchedSet.has(t.id)) pushUnique(t);

  const taskSubset = ranked.slice(0, 60);

  // RefId lookup with two paths:
  // (1) Task's own OpenProject id.
  // (2) Any `#NNNN` reference found inside the task title — common at IRN
  //     where the business ticket id (e.g. #6026) appears in the title of a
  //     task whose numeric OpenProject id is unrelated (#32397). Without
  //     this, a commit referencing #6026 silently fails to match #32397.
  const taskIndex = new Map<string, { id: string; title: string }>();
  for (const t of todoItems) {
    taskIndex.set(t.id, { id: t.id, title: t.title });
    for (const m of t.title.matchAll(/#(\d{3,6})\b/g)) {
      const ref = m[1];
      // Don't overwrite a primary id mapping; first task to claim a #ref wins.
      if (!taskIndex.has(ref)) taskIndex.set(ref, { id: t.id, title: t.title });
    }
  }

  const gitlabResult = inRangeActivity.length
    ? baselineFromGitLab(inRangeActivity, taskIndex, todoItems, input.dateRange)
    : { items: [], summary: undefined, unmatchedActivities: [] as GitLabActivity[] };
  const gitlabBaseline = gitlabResult.items;

  // Resolve the concrete expected hours for each weekday in the range so the
  // model has a hard per-day target instead of having to parse a season
  // description and compute day-of-week itself.
  const expectedHoursByDay: Record<string, number> = {};
  for (const dayKey of weekdaysInRange(input.dateRange.from, input.dateRange.to)) {
    expectedHoursByDay[dayKey] = expectedHoursFor(dayKey, input.schedule);
  }

  const promptInput = {
    description: input.description,
    from: input.dateRange.from,
    to: input.dateRange.to,
    tasks: taskSubset.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      statusId: t.statusId,
      timeline: t.timeline,
      totalHours: input.timeEntriesData?.[t.id],
    })),
    schedule: input.schedule,
    expectedHoursByDay,
    gitlabActivity: inRangeActivity,
    meetings: input.meetings ? { taskId: input.meetings.taskId, hours: input.meetings.hours } : undefined,
    availableStatuses: input.availableStatuses,
  };
  const messages = buildDistributePrompt(promptInput);
  const stats = promptStats(promptInput);

  const allowedIds = new Set(taskSubset.map(t => t.id));
  const allowedStatusIds = input.availableStatuses
    ? new Set(input.availableStatuses.map(s => s.id))
    : undefined;
  let raw = await provider.chat(messages, { jsonMode: true, jsonSchema: RESPONSE_SCHEMA, temperature: 0.1, signal: input.signal });
  // eslint-disable-next-line prefer-const
  let { actions: parsedActions, warnings, reasoning, itemsFieldMissing } = parseDistributeResponse(raw, allowedIds, input.dateRange, allowedStatusIds);
  let retried = false;

  // 9.5: retry once when the model returned a body with no "actions" field and we
  // actually had data to distribute. Use temperature 0 + schema enforcement.
  const hadDataToDistribute = taskSubset.length > 0 || inRangeActivity.length > 0;
  if (itemsFieldMissing && hadDataToDistribute) {
    retried = true;
    const retryMessages = [
      ...messages,
      { role: "assistant" as const, content: raw },
      {
        role: "user" as const,
        content: `Faltou o campo "actions" na resposta. Devolve o JSON completo {"reasoning":"...","actions":[...]} com pelo menos uma entrada por commit/MR ou tarefa relevante. Cada accao tem de ter "kind":"log_hours" ou "kind":"update_status".`,
      },
    ];
    try {
      raw = await provider.chat(retryMessages, { jsonMode: true, jsonSchema: RESPONSE_SCHEMA, temperature: 0, signal: input.signal });
      const reparsed = parseDistributeResponse(raw, allowedIds, input.dateRange, allowedStatusIds);
      parsedActions = reparsed.actions;
      reasoning = reparsed.reasoning ?? reasoning;
      warnings = [...warnings, "Resposta inicial sem campo actions — reformulada via retry.", ...reparsed.warnings];
    } catch (err) {
      warnings.push(`Retry da IA falhou: ${err instanceof Error ? err.message : "erro"}`);
    }
  }

  // Build the typed AIAction list. Resolve task titles + status names from the
  // subset we sent so the UI doesn't need to lookup again.
  const statusById = new Map<string, { id: string; name: string }>();
  for (const s of input.availableStatuses || []) statusById.set(s.id, { id: s.id, name: s.name });
  const aiHourActions: AIDistributionItem[] = [];
  const aiStatusActions: Array<Extract<AIAction, { kind: "update_status" }>> = [];
  for (const a of parsedActions) {
    const task = taskSubset.find(t => t.id === a.taskId);
    const taskTitle = task?.title || `Task #${a.taskId}`;
    if (a.kind === "log_hours") {
      aiHourActions.push({
        taskId: a.taskId,
        taskTitle,
        dayKey: a.dayKey,
        hours: a.hours,
        reason: a.reason,
        source: "ai",
        confidence: a.confidence,
      });
    } else {
      // Skip no-op transitions: if the task is already in the requested state.
      if (task?.statusId && task.statusId === a.toStatusId) {
        warnings.push(`Ignorada update_status para tarefa "${taskTitle}": ja esta no estado pedido.`);
        continue;
      }
      const toStatus = statusById.get(a.toStatusId);
      aiStatusActions.push({
        kind: "update_status",
        taskId: a.taskId,
        taskTitle,
        fromStatusId: task?.statusId,
        fromStatusName: task?.status,
        toStatusId: a.toStatusId,
        toStatusName: a.toStatusName || toStatus?.name || a.toStatusId,
        reason: a.reason,
        confidence: a.confidence,
        source: "ai",
      });
    }
  }
  const aiItems = aiHourActions;

  // Merge GitLab baseline + AI items, de-duplicating by (taskId, dayKey).
  // AI output now wins on collisions so prompt-prioritized tasks take precedence
  // over GitLab-derived baseline entries when both apply.
  const merged = new Map<string, AIDistributionItem>();
  for (const it of gitlabBaseline) merged.set(`${it.taskId}|${it.dayKey}`, it);
  for (const it of aiItems) merged.set(`${it.taskId}|${it.dayKey}`, it);

  // Inject the configured meetings task on every weekday in range that doesn't
  // already have it. Mirrors the QuickHoursForm behaviour for consistency.
  if (input.meetings && input.meetings.hours > 0) {
    for (const dayKey of weekdaysInRange(input.dateRange.from, input.dateRange.to)) {
      const key = `${input.meetings.taskId}|${dayKey}`;
      if (!merged.has(key)) {
        merged.set(key, {
          taskId: input.meetings.taskId,
          taskTitle: input.meetings.taskTitle,
          dayKey,
          hours: input.meetings.hours,
          reason: "Meetings (auto)",
          source: "manual",
          confidence: 1.0, // user-configured, deterministic
        });
      }
    }
  }

  let items = Array.from(merged.values()).sort((a, b) =>
    a.dayKey === b.dayKey ? a.taskTitle.localeCompare(b.taskTitle) : a.dayKey.localeCompare(b.dayKey)
  );

  // The meetings placeholder is a fixed reservation — it must never be scaled
  // up or down by the clamp/fill passes.
  const meetingsTaskId = input.meetings?.taskId;

  // Hard cap per-day totals to the user's expected hours (Mon-Thu vs Friday in their schedule).
  items = clampDailyTotals(items, input.schedule, warnings, meetingsTaskId);

  // Fill each active day UP to the expected hours so the user doesn't end up
  // with a partial day. Only touches days that have a REAL (non-meetings) task
  // — a day with only the meetings placeholder is left as-is (we never inflate
  // meetings or invent work where there's no matched task).
  items = fillDailyTotals(items, input.schedule, warnings, meetingsTaskId);

  if (items.length === 0 && aiStatusActions.length === 0 && top) {
    warnings.push(`Sugestao baseada apenas em correspondencia textual: ${top.task.title}`);
  }

  // Final plan: log_hours actions (after clamp+merge) + update_status actions
  // (untouched — they're singletons per task with no daily cap to enforce).
  const actions: AIAction[] = [
    ...items.map(it => ({
      kind: "log_hours" as const,
      taskId: it.taskId,
      taskTitle: it.taskTitle,
      dayKey: it.dayKey,
      hours: it.hours,
      reason: it.reason,
      source: it.source,
      confidence: it.confidence,
    })),
    ...aiStatusActions,
  ];

  const systemMsg = messages.find(m => m.role === "system")?.content || "";
  const userMsg = messages.find(m => m.role === "user")?.content || "";

  // Augment the base summary (from baselineFromGitLab) with the pre-filter totals,
  // even when there was zero in-range activity (so the UI can explain why).
  const gitlabSummary = gitlabResult.summary
    ? { ...gitlabResult.summary, totalReceived: totalActivityReceived, outOfRange: outOfRangeCount }
    : totalActivityReceived > 0
      ? {
          commits: 0,
          mrs: 0,
          matchedById: 0,
          matchedByFuzzy: 0,
          unmatched: 0,
          totalReceived: totalActivityReceived,
          outOfRange: outOfRangeCount,
        }
      : undefined;

  return {
    actions,
    items,
    warnings,
    reasoning,
    rawResponse: raw,
    gitlabSummary,
    unmatchedActivities: gitlabResult.unmatchedActivities,
    debug: {
      promptSystem: systemMsg,
      promptUser: userMsg,
      dateRange: input.dateRange,
      tasksSent: taskSubset.length,
      gitlabActivitySent: inRangeActivity.length,
      gitlabActivityReceived: totalActivityReceived,
      gitlabActivityDeduped: stats.dedupedCount,
      gitlabActivitySummarized: stats.summarized,
      promptCharCount: systemMsg.length + userMsg.length,
      responseCharCount: (raw || "").length,
      retried,
    },
  };
}

// Iterate every weekday (Mon–Fri) in [from, to] inclusive.
function* weekdaysInRange(from: string, to: string): Generator<string> {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    yield d.toISOString().slice(0, 10);
  }
}

function expectedHoursFor(dayKey: string, schedule: WorkSchedule): number {
  return expectedHoursForDayKey(dayKey, schedule);
}

// Split a day's items into the fixed meetings placeholder vs the scalable real
// tasks. Meetings are never resized by clamp/fill.
function splitMeetings(dayItems: AIDistributionItem[], meetingsTaskId?: string): { meetings: AIDistributionItem[]; scalable: AIDistributionItem[] } {
  if (!meetingsTaskId) return { meetings: [], scalable: dayItems };
  const meetings = dayItems.filter(i => i.taskId === meetingsTaskId);
  const scalable = dayItems.filter(i => i.taskId !== meetingsTaskId);
  return { meetings, scalable };
}

// Scale down each day's REAL tasks so the day total never exceeds the expected
// hours. The meetings placeholder is held fixed and its hours are reserved out
// of the budget. Snaps to 0.5h.
function clampDailyTotals(items: AIDistributionItem[], schedule: WorkSchedule, warnings: string[], meetingsTaskId?: string): AIDistributionItem[] {
  const byDay = new Map<string, AIDistributionItem[]>();
  for (const it of items) {
    if (!byDay.has(it.dayKey)) byDay.set(it.dayKey, []);
    byDay.get(it.dayKey)!.push(it);
  }
  const out: AIDistributionItem[] = [];
  for (const [dayKey, dayItems] of byDay) {
    const expected = expectedHoursFor(dayKey, schedule);
    if (expected === 0) {
      warnings.push(`${dayKey} e fim-de-semana — entradas descartadas.`);
      continue; // weekends: drop everything
    }
    const { meetings, scalable } = splitMeetings(dayItems, meetingsTaskId);
    const meetingsHours = meetings.reduce((s, it) => s + it.hours, 0);
    const budget = Math.max(0.5, expected - meetingsHours); // hours available for real tasks
    const total = scalable.reduce((s, it) => s + it.hours, 0);
    if (total <= budget) {
      out.push(...dayItems);
      continue;
    }
    const scale = budget / total;
    const scaled = scalable.map(it => ({
      ...it,
      hours: Math.max(0.5, Math.round(it.hours * scale * 2) / 2),
    }));
    let runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
    while (runningTotal > budget) {
      const idx = scaled.reduce((maxIdx, it, i) => it.hours > scaled[maxIdx].hours ? i : maxIdx, 0);
      if (scaled[idx].hours <= 0.5) break;
      scaled[idx].hours -= 0.5;
      runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
    }
    warnings.push(`${dayKey}: proposta original ${total.toFixed(1)}h excedia o disponivel (${budget}h) — escalado.`);
    out.push(...meetings, ...scaled);
  }
  return out;
}

// Scale UP a day's REAL tasks so the day reaches the expected hours. Only days
// that have at least one real (non-meetings) task are filled — a day with only
// the meetings placeholder is left untouched (we never inflate meetings or
// invent work where there's no matched task). Meetings hours stay fixed and are
// reserved out of the target. Snaps to 0.5h.
function fillDailyTotals(items: AIDistributionItem[], schedule: WorkSchedule, warnings: string[], meetingsTaskId?: string): AIDistributionItem[] {
  const byDay = new Map<string, AIDistributionItem[]>();
  for (const it of items) {
    if (!byDay.has(it.dayKey)) byDay.set(it.dayKey, []);
    byDay.get(it.dayKey)!.push(it);
  }
  const out: AIDistributionItem[] = [];
  for (const [dayKey, dayItems] of byDay) {
    const expected = expectedHoursFor(dayKey, schedule);
    const { meetings, scalable } = splitMeetings(dayItems, meetingsTaskId);
    const meetingsHours = meetings.reduce((s, it) => s + it.hours, 0);
    const target = Math.max(0, expected - meetingsHours); // real-task hours target
    const total = scalable.reduce((s, it) => s + it.hours, 0);
    // Don't fill weekends, already-full days, or days with no real task.
    if (expected === 0 || scalable.length === 0 || total >= target) {
      out.push(...dayItems);
      continue;
    }
    const scale = target / total;
    const scaled = scalable.map(it => ({
      ...it,
      hours: Math.max(0.5, Math.round(it.hours * scale * 2) / 2),
    }));
    let runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
    let guard = 0;
    while (runningTotal < target && guard < 100) {
      const idx = scaled.reduce((maxIdx, it, i) => it.hours > scaled[maxIdx].hours ? i : maxIdx, 0);
      scaled[idx].hours += 0.5;
      runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
      guard++;
    }
    warnings.push(`${dayKey}: proposta de tarefas (${total.toFixed(1)}h) preenchida ate ${target}h (+ ${meetingsHours}h meetings).`);
    out.push(...meetings, ...scaled);
  }
  return out;
}
