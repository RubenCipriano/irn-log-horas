import type { WorkSchedule, TaskStatusTimeline, StatusSegment, GitLabActivity } from "@/types";
import type { ChatMessage } from "./provider";

// Only keep segments overlapping the requested date range. The LLM doesn't need
// the task's full history — it needs to know what state the task is in DURING
// the days we're asking it to propose hours for.
function segmentsOverlappingRange(segments: StatusSegment[], from: string, to: string): StatusSegment[] {
  return segments.filter(s => {
    const segStart = s.fromDate;
    const segEnd = s.toDate ?? "9999-12-31";
    return segStart <= to && segEnd >= from;
  });
}

function describeSchedule(schedule: WorkSchedule): string {
  return `verao: seg-qui ${schedule.summer.monThu}h, sex ${schedule.summer.fri}h. inverno: seg-qui ${schedule.winter.monThu}h, sex ${schedule.winter.fri}h.`;
}

// Deduplicate GitLab activity by (title, date). The same commit pushed to N projects
// shows up N times; keep only the first. Heavy reduction for monorepo-style work.
function dedupActivity(activities: GitLabActivity[]): GitLabActivity[] {
  const seen = new Set<string>();
  const out: GitLabActivity[] = [];
  for (const a of activities) {
    const key = `${a.title}|${a.createdAt.split("T")[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// When activity count is high, swap the listing for a per-day summary.
// Keeps signal (refIds, top titles per day) and cuts ~10x tokens.
type ActivitySummary = {
  d: string;        // date
  c: number;        // commits
  m: number;        // MRs
  r: string[];      // unique refIds across all items that day
  t: string[];      // up to 5 representative titles
};

function summariseActivity(activities: GitLabActivity[]): ActivitySummary[] {
  const byDay = new Map<string, GitLabActivity[]>();
  for (const a of activities) {
    const d = a.createdAt.split("T")[0];
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(a);
  }
  const out: ActivitySummary[] = [];
  for (const [d, items] of byDay) {
    const c = items.filter(i => i.type === "commit").length;
    const m = items.filter(i => i.type === "merge_request").length;
    const r = Array.from(new Set(items.flatMap(i => i.refIds)));
    const t = items.slice(0, 5).map(i => i.title.slice(0, 80));
    out.push({ d, c, m, r, t });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}

export type DistributePromptInput = {
  description: string;
  from: string;
  to: string;
  tasks: { id: string; title: string; status?: string; timeline?: TaskStatusTimeline }[];
  schedule: WorkSchedule;
  gitlabActivity?: GitLabActivity[];
  meetings?: { taskId: string; hours: number };
};

const SUMMARY_THRESHOLD = 30;

export function buildDistributePrompt(input: DistributePromptInput): ChatMessage[] {
  // Compact task representation: short keys + segments as tuples + only in-range segments.
  const taskSummaries = input.tasks.map(t => {
    const segments = t.timeline
      ? segmentsOverlappingRange(t.timeline.segments, input.from, input.to)
      : [];
    return {
      id: t.id,
      t: t.title,
      st: t.status,
      seg: segments.map(s => [s.status, s.fromDate, s.toDate, s.inferred ? 1 : 0] as const),
    };
  });

  // Dedup + decide listing vs summary form.
  const deduped = input.gitlabActivity?.length ? dedupActivity(input.gitlabActivity) : [];
  const useSummary = deduped.length > SUMMARY_THRESHOLD;

  const gitlabList = !useSummary && deduped.length > 0
    ? deduped.map(a => ({
        k: a.type === "merge_request" ? "mr" : "c",
        t: a.title.slice(0, 80),
        d: a.createdAt.split("T")[0],
        r: a.refIds,
      }))
    : undefined;

  const gitlabSummary = useSummary ? summariseActivity(deduped) : undefined;

  const hasGitlab = deduped.length > 0;

  // Tight, bulleted system prompt. Lower-tier models follow short rules better
  // than long rhetoric. ~700 chars.
  const system = `Distribui horas de trabalho num calendario OpenProject.

Devolves SO este JSON: {"reasoning":"...","items":[{"taskId":"...","dayKey":"YYYY-MM-DD","hours":<num>,"reason":"..."}]}

Regras:
- hours: multiplo de 0.5
- taskId: tem de existir em "tarefas" (campo id)
- dayKey: dentro de {from}..{to}, so dias uteis (seg-sex)
- ignora tarefas com status terminal (desenvolvido / closed / fechado / on hold / bloqueado / rejeitado)
- soma diaria <= horas esperadas (campo "horario")
- prefere tarefas em "Em Desenvolvimento"; reduz em estados de revisao (MR em DEV/QA, em teste)
- segmentos com inferred=1 sao assumpcoes; usa valores conservadores
${hasGitlab ? `- cada commit/MR em "atividade_gitlab" (ou "atividade_resumo") gera 1+ entradas em items: associa por #ID em "r" ou pelo titulo "t" mais parecido com uma tarefa
- items so pode ser [] quando "atividade_gitlab"/"atividade_resumo" pedido mas vazio` : ""}
${input.meetings ? `- IMPORTANTE: meetings serao injectados AUTOMATICAMENTE pelo sistema (taskId="${input.meetings.taskId}", ${input.meetings.hours}h por dia util). NAO incluas a task de meetings nos teus items. Deixa ${input.meetings.hours}h por dia livres para ela.` : ""}
- reason max 60 chars; reasoning max 300 chars`;

  const userPayload: Record<string, unknown> = {
    descricao: input.description,
    intervalo: { from: input.from, to: input.to },
    horario: describeSchedule(input.schedule),
    tarefas: taskSummaries,
  };
  if (gitlabList) userPayload.atividade_gitlab = gitlabList;
  if (gitlabSummary) userPayload.atividade_resumo = gitlabSummary;

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(userPayload) },
  ];
}

// Parse and validate LLM output. Returns { items, warnings, reasoning, itemsFieldMissing }.
export function parseDistributeResponse(
  raw: string,
  allowedTaskIds: Set<string>,
  range: { from: string; to: string },
): { items: { taskId: string; dayKey: string; hours: number; reason: string }[]; warnings: string[]; reasoning?: string; itemsFieldMissing: boolean } {
  const warnings: string[] = [];
  let parsed: unknown;
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    warnings.push("Resposta da IA nao era JSON valido.");
    return { items: [], warnings, itemsFieldMissing: true };
  }

  let candidateArray: unknown[] = [];
  let reasoning: string | undefined;
  let itemsFieldMissing = true;

  if (Array.isArray(parsed)) {
    candidateArray = parsed;
    itemsFieldMissing = false;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as { items?: unknown; reasoning?: unknown; thinking?: unknown };
    if ("items" in obj) {
      itemsFieldMissing = false;
      if (Array.isArray(obj.items)) candidateArray = obj.items;
    }
    const r = obj.reasoning ?? obj.thinking;
    if (typeof r === "string" && r.trim()) reasoning = r.slice(0, 1200);
    if (itemsFieldMissing && !reasoning) {
      warnings.push("Resposta da IA nao continha items nem reasoning reconhecivel.");
      return { items: [], warnings, itemsFieldMissing: true };
    }
  } else {
    warnings.push("Resposta da IA nao era um objecto JSON.");
    return { items: [], warnings, itemsFieldMissing: true };
  }

  const items: { taskId: string; dayKey: string; hours: number; reason: string }[] = [];
  for (const raw of candidateArray) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const taskId = typeof r.taskId === "string" ? r.taskId : String(r.taskId ?? "");
    const dayKey = typeof r.dayKey === "string" ? r.dayKey : "";
    const hoursRaw = typeof r.hours === "number" ? r.hours : parseFloat(String(r.hours ?? "0"));
    const reason = typeof r.reason === "string" ? r.reason : "";

    if (!taskId || !allowedTaskIds.has(taskId)) {
      warnings.push(`Ignorada entrada com taskId invalido: ${taskId || "(vazio)"}`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      warnings.push(`Ignorada entrada com dayKey invalido: ${dayKey}`);
      continue;
    }
    if (dayKey < range.from || dayKey > range.to) {
      warnings.push(`Ignorada entrada fora do intervalo: ${dayKey}`);
      continue;
    }
    if (!Number.isFinite(hoursRaw) || hoursRaw <= 0) continue;
    const hours = Math.max(0.5, Math.round(hoursRaw * 2) / 2);

    items.push({ taskId, dayKey, hours, reason: reason.slice(0, 120) });
  }

  return { items, warnings, reasoning, itemsFieldMissing };
}

// Counts useful for the Inspector / debug payload.
export function promptStats(input: DistributePromptInput): { dedupedCount: number; summarized: boolean; receivedCount: number } {
  const received = input.gitlabActivity?.length || 0;
  const deduped = received > 0 ? dedupActivity(input.gitlabActivity!) : [];
  return {
    receivedCount: received,
    dedupedCount: deduped.length,
    summarized: deduped.length > SUMMARY_THRESHOLD,
  };
}
