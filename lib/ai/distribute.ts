import type { TodoItem, TaskStatusTimeline, StatusWeightConfig, WorkSchedule, AIDistributionItem, AIProviderConfig, GitLabActivity } from "@/types";
import { getProvider } from "./factory";
import { matchTasks } from "./matcher";
import { buildDistributePrompt, parseDistributeResponse, promptStats } from "./prompt";

// JSON schema describing the LLM's expected output. Providers that support
// structured output enforce this client-side; others fall back to jsonMode.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          dayKey: { type: "string" },
          hours: { type: "number" },
          reason: { type: "string" },
        },
        required: ["taskId", "dayKey", "hours"],
      },
    },
  },
  required: ["reasoning", "items"],
} as const;

export type DistributeInput = {
  description: string;
  dateRange: { from: string; to: string };
  tasks: (Pick<TodoItem, "id" | "title" | "status"> & { timeline?: TaskStatusTimeline })[];
  weights: StatusWeightConfig;
  schedule: WorkSchedule;
  providerConfig: AIProviderConfig;
  gitlabActivity?: GitLabActivity[];
  meetings?: { taskId: string; taskTitle: string; hours: number };
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

  const matchedSet = new Set(matches.map(m => m.task.id));
  const ranked = [
    ...matches.map(m => m.task),
    ...todoItems.filter(t => !matchedSet.has(t.id)),
  ];
  // Cap at 60 to control prompt token cost — covers nearly all realistic sprints.
  const taskSubset = ranked.slice(0, 60);

  const taskIndex = new Map<string, { id: string; title: string }>();
  for (const t of todoItems) taskIndex.set(t.id, { id: t.id, title: t.title });

  const gitlabResult = inRangeActivity.length
    ? baselineFromGitLab(inRangeActivity, taskIndex, todoItems, input.dateRange)
    : { items: [], summary: undefined, unmatchedActivities: [] as GitLabActivity[] };
  const gitlabBaseline = gitlabResult.items;

  const promptInput = {
    description: input.description,
    from: input.dateRange.from,
    to: input.dateRange.to,
    tasks: taskSubset.map(t => ({ id: t.id, title: t.title, status: t.status, timeline: t.timeline })),
    schedule: input.schedule,
    gitlabActivity: inRangeActivity,
    meetings: input.meetings ? { taskId: input.meetings.taskId, hours: input.meetings.hours } : undefined,
  };
  const messages = buildDistributePrompt(promptInput);
  const stats = promptStats(promptInput);

  const allowedIds = new Set(taskSubset.map(t => t.id));
  let raw = await provider.chat(messages, { jsonMode: true, jsonSchema: RESPONSE_SCHEMA, temperature: 0.1, signal: input.signal });
  // eslint-disable-next-line prefer-const
  let { items: parsedItems, warnings, reasoning, itemsFieldMissing } = parseDistributeResponse(raw, allowedIds, input.dateRange);
  let retried = false;

  // 9.5: retry once when the model returned a body with no "items" field and we
  // actually had data to distribute. Use temperature 0 + schema enforcement.
  const hadDataToDistribute = taskSubset.length > 0 || inRangeActivity.length > 0;
  if (itemsFieldMissing && hadDataToDistribute) {
    retried = true;
    const retryMessages = [
      ...messages,
      { role: "assistant" as const, content: raw },
      {
        role: "user" as const,
        content: `Faltou o campo "items" na resposta. Devolve o JSON completo {"reasoning":"...","items":[...]} com pelo menos uma entrada por commit/MR ou tarefa relevante.`,
      },
    ];
    try {
      raw = await provider.chat(retryMessages, { jsonMode: true, jsonSchema: RESPONSE_SCHEMA, temperature: 0, signal: input.signal });
      const reparsed = parseDistributeResponse(raw, allowedIds, input.dateRange);
      parsedItems = reparsed.items;
      reasoning = reparsed.reasoning ?? reasoning;
      warnings = [...warnings, "Resposta inicial sem campo items — reformulada via retry.", ...reparsed.warnings];
    } catch (err) {
      warnings.push(`Retry da IA falhou: ${err instanceof Error ? err.message : "erro"}`);
    }
  }

  // Enrich with task title (the LLM only sees IDs in the response)
  const aiItems: AIDistributionItem[] = parsedItems.map(it => {
    const task = taskSubset.find(t => t.id === it.taskId);
    return {
      taskId: it.taskId,
      taskTitle: task?.title || `Task #${it.taskId}`,
      dayKey: it.dayKey,
      hours: it.hours,
      reason: it.reason,
      source: "ai" as const,
    };
  });

  // Merge GitLab baseline + AI items, de-duplicating by (taskId, dayKey).
  // GitLab baseline wins on collisions because it's grounded in real activity.
  const merged = new Map<string, AIDistributionItem>();
  for (const it of aiItems) merged.set(`${it.taskId}|${it.dayKey}`, it);
  for (const it of gitlabBaseline) merged.set(`${it.taskId}|${it.dayKey}`, it);

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
        });
      }
    }
  }

  let items = Array.from(merged.values()).sort((a, b) =>
    a.dayKey === b.dayKey ? a.taskTitle.localeCompare(b.taskTitle) : a.dayKey.localeCompare(b.dayKey)
  );

  // Hard cap per-day totals to the user's expected hours (Mon-Thu vs Friday in their schedule).
  items = clampDailyTotals(items, input.schedule, warnings);

  if (items.length === 0 && top) {
    warnings.push(`Sugestao baseada apenas em correspondencia textual: ${top.task.title}`);
  }

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
  const d = new Date(dayKey + "T00:00:00");
  const month = d.getMonth();
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 0;
  const isSummer = month >= schedule.summerMonths[0] && month < schedule.summerMonths[1];
  const season = isSummer ? schedule.summer : schedule.winter;
  return dow >= 1 && dow <= 4 ? season.monThu : season.fri;
}

// Scale down each day's items so the sum never exceeds the user's expected hours for that day.
// Preserves relative proportions and snaps to 0.5h increments.
function clampDailyTotals(items: AIDistributionItem[], schedule: WorkSchedule, warnings: string[]): AIDistributionItem[] {
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
    const total = dayItems.reduce((s, it) => s + it.hours, 0);
    if (total <= expected) {
      out.push(...dayItems);
      continue;
    }
    // Scale all items down proportionally to fit `expected`.
    const scale = expected / total;
    const scaled = dayItems.map(it => ({
      ...it,
      hours: Math.max(0.5, Math.round(it.hours * scale * 2) / 2),
    }));
    // Trim 0.5h at a time from largest until <= expected (rounding can overshoot).
    let runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
    while (runningTotal > expected) {
      const idx = scaled.reduce((maxIdx, it, i) => it.hours > scaled[maxIdx].hours ? i : maxIdx, 0);
      if (scaled[idx].hours <= 0.5) break;
      scaled[idx].hours -= 0.5;
      runningTotal = scaled.reduce((s, it) => s + it.hours, 0);
    }
    warnings.push(`${dayKey}: proposta original ${total.toFixed(1)}h excedia o esperado (${expected}h) — escalado.`);
    out.push(...scaled);
  }
  return out;
}
