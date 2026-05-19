"use client";

import { useMemo, useState } from "react";
import type { AIDistributionItem, TodoItem } from "@/types";
import { formatHours } from "@/lib/calendar-utils";
import { useToast } from "@/components/Toast";
import ModalCloseButton from "@/components/ModalCloseButton";

type GitLabSummary = {
  commits: number;
  mrs: number;
  matchedById: number;
  matchedByFuzzy: number;
  unmatched: number;
  totalReceived?: number;
  outOfRange?: number;
};

type UnmatchedActivity = {
  type: "commit" | "merge_request";
  title: string;
  project: string;
  createdAt: string;
  refIds: string[];
  url: string;
};

type DebugInfo = {
  promptSystem: string;
  promptUser: string;
  dateRange: { from: string; to: string };
  tasksSent: number;
  gitlabActivitySent: number;
  gitlabActivityReceived?: number;
  gitlabActivityDeduped?: number;
  gitlabActivitySummarized?: boolean;
  promptCharCount?: number;
  responseCharCount?: number;
  retried?: boolean;
};

type Props = {
  items: AIDistributionItem[];
  allTasks: TodoItem[];
  onCancel: () => void;
  onConfirm: (items: AIDistributionItem[]) => void;
  isSaving: boolean;
  getExpectedHours: (date: Date) => number | null;
  reasoning?: string;
  warnings?: string[];
  rawResponse?: string;
  gitlabSummary?: GitLabSummary;
  unmatchedActivities?: UnmatchedActivity[];
  gitlabActivities?: UnmatchedActivity[]; // all in-range activity the AI saw
  debug?: DebugInfo;
  onRefine?: (feedback: string) => void;   // re-prompt with user feedback
  originalDescription?: string;
};

function formatDay(dayKey: string): string {
  return new Date(dayKey + "T00:00:00").toLocaleDateString("pt-PT", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function AIPreviewModal({ items, allTasks, onCancel, onConfirm, isSaving, getExpectedHours, reasoning, warnings, rawResponse, gitlabSummary, unmatchedActivities, gitlabActivities, debug, onRefine, originalDescription }: Props) {
  const { addToast } = useToast();
  const [working, setWorking] = useState<AIDistributionItem[]>(items);
  const [showRaw, setShowRaw] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showGitlabActivity, setShowGitlabActivity] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [refineText, setRefineText] = useState<string>("");
  const unmatchedCount = unmatchedActivities?.length ?? 0;
  const totalActivitySeen = gitlabActivities?.length ?? 0;

  const submitRefine = () => {
    if (!refineText.trim() || !onRefine) return;
    onRefine(refineText.trim());
    setShowRefine(false);
    setRefineText("");
  };

  const grouped = useMemo(() => {
    const map = new Map<string, AIDistributionItem[]>();
    for (const it of working) {
      if (!map.has(it.dayKey)) map.set(it.dayKey, []);
      map.get(it.dayKey)!.push(it);
    }
    return Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [working]);

  const totalHours = working.reduce((s, it) => s + it.hours, 0);

  // Per-day cap check: any day whose total exceeds expected hours blocks the save.
  const overCapDays = useMemo(() => {
    const offenders: { dayKey: string; total: number; expected: number }[] = [];
    for (const [dayKey, dayItems] of grouped) {
      const date = new Date(dayKey + "T00:00:00");
      const expected = getExpectedHours(date);
      if (expected === null || expected === 0) continue;
      const total = dayItems.reduce((s, it) => s + it.hours, 0);
      if (total > expected) offenders.push({ dayKey, total, expected });
    }
    return offenders;
  }, [grouped, getExpectedHours]);

  const gitlabCount = working.filter(it => it.source === "gitlab").length;
  const aiCount = working.filter(it => it.source === "ai").length;

  // Lift "Nao encontrei a tarefa #NNNN..." sentences out of the reasoning into a
  // dedicated yellow banner so the user notices unresolved mentions at a glance.
  const unmatchedMentions = useMemo<string[]>(() => {
    if (!reasoning) return [];
    const re = /Nao encontrei a tarefa[^.\n]*?(?:\.|$|\n)/gi;
    return Array.from(reasoning.matchAll(re), m => m[0].trim().replace(/\.$/, ""));
  }, [reasoning]);

  const updateHours = (idx: number, hours: number) => {
    setWorking(prev => prev.map((it, i) => i === idx ? { ...it, hours: Math.max(0, Math.round(hours * 2) / 2) } : it));
  };

  const removeItem = (idx: number) => {
    setWorking(prev => prev.filter((_, i) => i !== idx));
  };

  // Auto-scale each over-cap day so the total fits exactly the expected hours.
  const autoAdjust = () => {
    setWorking(prev => {
      const byDay = new Map<string, AIDistributionItem[]>();
      for (const it of prev) {
        if (!byDay.has(it.dayKey)) byDay.set(it.dayKey, []);
        byDay.get(it.dayKey)!.push(it);
      }
      const next: AIDistributionItem[] = [];
      for (const [dayKey, dayItems] of byDay) {
        const date = new Date(dayKey + "T00:00:00");
        const expected = getExpectedHours(date);
        const total = dayItems.reduce((s, it) => s + it.hours, 0);
        if (!expected || total <= expected) { next.push(...dayItems); continue; }
        const scale = expected / total;
        const scaled = dayItems.map(it => ({ ...it, hours: Math.max(0.5, Math.round(it.hours * scale * 2) / 2) }));
        let running = scaled.reduce((s, it) => s + it.hours, 0);
        while (running > expected) {
          const idx = scaled.reduce((maxIdx, it, i) => it.hours > scaled[maxIdx].hours ? i : maxIdx, 0);
          if (scaled[idx].hours <= 0.5) break;
          scaled[idx].hours -= 0.5;
          running = scaled.reduce((s, it) => s + it.hours, 0);
        }
        next.push(...scaled);
      }
      return next;
    });
  };

  const submit = () => {
    if (overCapDays.length > 0) return; // safety net — button should be disabled too
    const filtered = working.filter(it => it.hours > 0);
    onConfirm(filtered);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in" onClick={onCancel}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Proposta da IA</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Revê e ajusta as horas antes de guardar. Linhas sem horas serão ignoradas.
            </p>
          </div>
          <ModalCloseButton onClick={onCancel} />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Unmatched-mention banner — surfaces "Nao encontrei a tarefa #NNNN" lines */}
          {unmatchedMentions.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/40 p-3">
              <div className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
                  <path d="M8 1.5L1.5 13.5h13L8 1.5zM8 6v3M8 11.5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-amber-700 dark:text-amber-300 mb-1">
                    Tarefas mencionadas mas nao encontradas
                  </p>
                  <ul className="space-y-0.5">
                    {unmatchedMentions.map((line, i) => (
                      <li key={i} className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* AI reasoning panel — always shown if present */}
          {reasoning && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50 dark:bg-indigo-950/30 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-indigo-600 dark:text-indigo-400">
                  <path d="M8 1.5a4.5 4.5 0 0 0-3 7.85V11h6V9.35A4.5 4.5 0 0 0 8 1.5zM6 12h4M6.5 14h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="text-[10px] uppercase font-semibold tracking-wide text-indigo-700 dark:text-indigo-300">Como a IA pensou</p>
              </div>
              <p className="text-xs text-indigo-900 dark:text-indigo-100 leading-relaxed whitespace-pre-wrap">{reasoning}</p>
            </div>
          )}

          {/* GitLab summary — what was found in the range */}
          {gitlabSummary && (
            <div className="rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50 dark:bg-orange-950/30 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-600 dark:text-orange-400">
                    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78L4.69 2.6c.1-.32.41-.54.75-.54s.65.22.75.54l2.42 7.07h8.78l2.42-7.07c.1-.32.41-.54.75-.54s.65.22.75.54l2.42 7.07 1.22 3.78c.13.36-.04.74-.3.94" fill="currentColor" />
                  </svg>
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-orange-700 dark:text-orange-300">Atividade GitLab</p>
                </div>
                {totalActivitySeen > 0 && (
                  <button
                    onClick={() => setShowGitlabActivity(true)}
                    className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 underline decoration-dotted hover:no-underline"
                  >
                    Ver {totalActivitySeen} item(s)
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-950/60 px-2 py-0.5 text-[11px] text-orange-800 dark:text-orange-200 font-medium">
                  {gitlabSummary.commits} commit{gitlabSummary.commits === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-950/60 px-2 py-0.5 text-[11px] text-orange-800 dark:text-orange-200 font-medium">
                  {gitlabSummary.mrs} MR{gitlabSummary.mrs === 1 ? "" : "s"}
                </span>
                {gitlabSummary.matchedById > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-200 font-medium">
                    {gitlabSummary.matchedById} por #ID
                  </span>
                )}
                {gitlabSummary.matchedByFuzzy > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-200 font-medium">
                    {gitlabSummary.matchedByFuzzy} por titulo
                  </span>
                )}
                {gitlabSummary.unmatched > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                    {gitlabSummary.unmatched} sem correspondencia
                  </span>
                )}
              </div>

              {/* Show the total / out-of-range split when GitLab returned more than we used */}
              {gitlabSummary.totalReceived !== undefined && gitlabSummary.outOfRange !== undefined && gitlabSummary.outOfRange > 0 && (
                <p className="text-[11px] text-orange-700 dark:text-orange-300 leading-relaxed mb-1.5">
                  <strong>{gitlabSummary.totalReceived}</strong> item(s) recebido(s) no total · <strong>{gitlabSummary.outOfRange}</strong> fora do intervalo.
                </p>
              )}

              {/* Nothing in range but something was received: clear explanation */}
              {gitlabSummary.commits + gitlabSummary.mrs === 0 && (gitlabSummary.totalReceived || 0) > 0 && (
                <p className="text-[11px] text-orange-700 dark:text-orange-300 leading-relaxed">
                  Encontrei <strong>{gitlabSummary.totalReceived}</strong> item(s) recentes no GitLab mas nenhum dentro do intervalo escolhido. Alarga o intervalo (Esta semana / Este mes) ou escolhe outro dia.
                </p>
              )}

              {/* Activity exists in range but none mapped to tasks */}
              {gitlabSummary.matchedById + gitlabSummary.matchedByFuzzy === 0 && gitlabSummary.commits + gitlabSummary.mrs > 0 && (
                <p className="text-[11px] text-orange-700 dark:text-orange-300 leading-relaxed">
                  Encontrei atividade mas nenhuma faz referencia a tarefas do OpenProject. Inclui <code className="font-mono bg-orange-100 dark:bg-orange-950/60 px-1 rounded">#32195</code> no titulo dos commits para associacao automatica.
                </p>
              )}
            </div>
          )}

          {/* GitLab + IA source counts (in current proposal) */}
          {(gitlabCount > 0 || aiCount > 0) && (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Linhas propostas:</span>
              {gitlabCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-950/40 px-2 py-0.5 text-orange-700 dark:text-orange-300 font-medium">
                  GitLab · {gitlabCount}
                </span>
              )}
              {aiCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-950/40 px-2 py-0.5 text-indigo-700 dark:text-indigo-300 font-medium">
                  IA · {aiCount}
                </span>
              )}
            </div>
          )}

          {/* Daily-cap warnings */}
          {overCapDays.length > 0 && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 mb-1">Limite diario excedido</p>
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-relaxed">
                    {overCapDays.length === 1
                      ? `O dia ${formatDay(overCapDays[0].dayKey)} tem ${formatHours(overCapDays[0].total)}h propostas mas o limite e ${overCapDays[0].expected}h.`
                      : `${overCapDays.length} dias excedem o limite diario.`}
                  </p>
                </div>
                <button
                  onClick={autoAdjust}
                  className="rounded-lg bg-rose-500 hover:bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white transition shrink-0"
                >
                  Auto-ajustar
                </button>
              </div>
            </div>
          )}

          {/* Warnings from server */}
          {warnings && warnings.length > 0 && (
            <details className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-2.5">
              <summary className="cursor-pointer text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                {warnings.length} aviso{warnings.length === 1 ? "" : "s"} do servidor
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-800 dark:text-amber-200 list-disc list-inside">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          {/* Raw response when there are no items — helps the user understand why */}
          {grouped.length === 0 && rawResponse && (
            <details className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5" open={!reasoning}>
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Resposta bruta da IA
              </summary>
              <pre className="mt-2 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{rawResponse}</pre>
            </details>
          )}

          {grouped.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-700 dark:text-slate-200 font-medium mb-1">A IA nao propos horas para este pedido.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {gitlabSummary && gitlabSummary.commits + gitlabSummary.mrs === 0
                  ? "Nao foram encontrados commits nem MRs teus no intervalo. Verifica a configuracao do GitLab ou alarga o intervalo."
                  : unmatchedCount > 0
                    ? `Encontrei ${unmatchedCount} commit(s)/MR(s) no GitLab mas a IA nao os associou a tarefas. Tenta reformular a descricao ou inclui #ID nos titulos dos commits.`
                    : reasoning
                      ? "Vê o painel acima — a IA explicou porquê. Tenta reformular a descricao ou alargar o intervalo."
                      : "Tenta uma descricao mais especifica."}
              </p>
            </div>
          ) : (
            grouped.map(([dayKey, dayItems]) => {
              const dayTotal = dayItems.reduce((s, it) => s + it.hours, 0);
              const date = new Date(dayKey + "T00:00:00");
              const expected = getExpectedHours(date) || 0;
              const overCap = expected > 0 && dayTotal > expected;
              return (
                <div key={dayKey} className={`rounded-xl border bg-[var(--surface-2)] dark:bg-slate-800/50 p-3 ${overCap ? "border-rose-300 dark:border-rose-800" : "border-slate-200 dark:border-slate-700"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 capitalize">{formatDay(dayKey)}</p>
                    <span className={`text-xs font-mono ${overCap ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-slate-500 dark:text-slate-400"}`}>
                      {formatHours(dayTotal)}h{expected > 0 ? ` / ${expected}h` : ""}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {dayItems.map(it => {
                      const idx = working.indexOf(it);
                      const task = allTasks.find(t => t.id === it.taskId);
                      return (
                        <div key={`${dayKey}-${it.taskId}-${idx}`} className="flex items-start gap-2 rounded-lg bg-white dark:bg-slate-900 p-2 border border-slate-200 dark:border-slate-700">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm text-slate-900 dark:text-slate-100 truncate">{it.taskTitle}</p>
                              {it.source === "gitlab" && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-950/40 px-1.5 py-0.5 rounded">
                                  GitLab
                                </span>
                              )}
                              {it.source === "ai" && (
                                <span className="text-[9px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
                                  IA
                                </span>
                              )}
                              {typeof it.confidence === "number" && (() => {
                                const c = it.confidence;
                                const label = c >= 0.8 ? "alta" : c >= 0.5 ? "media" : "baixa";
                                const cls = c >= 0.8
                                  ? "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40"
                                  : c >= 0.5
                                    ? "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40"
                                    : "text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-950/40";
                                return (
                                  <span
                                    className={`inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${cls}`}
                                    title={`Confianca da IA: ${Math.round(c * 100)}%`}
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${c >= 0.8 ? "bg-emerald-500" : c >= 0.5 ? "bg-amber-500" : "bg-orange-500"}`} />
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">#{it.taskId}</span>
                              {task?.status && <span className="text-[10px] text-slate-500 dark:text-slate-400">· {task.status}</span>}
                            </div>
                            {it.reason && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-1">{it.reason}</p>
                            )}
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={12}
                            step={0.5}
                            value={it.hours}
                            onChange={e => updateHours(idx, parseFloat(e.target.value) || 0)}
                            className="w-16 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm text-center font-semibold text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            onClick={() => removeItem(idx)}
                            className="rounded p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                            title="Remover esta entrada"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Total: <strong className="text-slate-900 dark:text-slate-100">{formatHours(totalHours)}h</strong> em {grouped.length} dia(s)
              </span>
              {rawResponse && (
                <button
                  onClick={() => setShowRaw(s => !s)}
                  className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline"
                >
                  {showRaw ? "Esconder" : "Ver"} resposta bruta
                </button>
              )}
              {debug && (
                <button
                  onClick={() => setShowInspector(true)}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                >
                  Inspecionar I/O
                </button>
              )}
              {onRefine && (
                <button
                  onClick={() => setShowRefine(v => !v)}
                  className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline font-medium"
                >
                  {showRefine ? "Esconder feedback" : "Refazer com feedback"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={isSaving || working.length === 0 || overCapDays.length > 0}
                title={overCapDays.length > 0 ? "Ajusta os dias que excedem o limite antes de guardar." : ""}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "A guardar..." : "Aceitar e guardar"}
              </button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Nada e guardado em OpenProject ate clicares <strong>Aceitar e guardar</strong>.
          </p>
          {showRaw && rawResponse && (
            <pre className="text-[10px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto bg-white dark:bg-slate-900 rounded p-2 border border-slate-200 dark:border-slate-700">{rawResponse}</pre>
          )}
          {showRefine && onRefine && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Refazer com feedback
              </p>
              {originalDescription && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400/80">
                  Pedido original: <em className="italic">{originalDescription.slice(0, 120)}{originalDescription.length > 120 ? "..." : ""}</em>
                </p>
              )}
              <textarea
                value={refineText}
                onChange={e => setRefineText(e.target.value)}
                placeholder="Ex: as horas no dia 19 estao trocadas; a tarefa X deveria ter mais horas; nao incluas commits de bump deps..."
                className="w-full min-h-[80px] resize-none rounded-md border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-amber-500 focus:outline-none"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowRefine(false); setRefineText(""); }}
                  className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={submitRefine}
                  disabled={!refineText.trim() || isSaving}
                  className="rounded-md bg-amber-500 hover:bg-amber-600 px-3 py-1 text-[11px] font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Submeter e refazer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GitLab activity overlay — full list of commits/MRs the AI saw */}
      {showGitlabActivity && gitlabActivities && gitlabActivities.length > 0 && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/70 p-4 animate-fade-in" onClick={() => setShowGitlabActivity(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[88vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Atividade GitLab no intervalo
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {gitlabActivities.length} item(s) que a IA viu. Verifica se as recomendacoes batem certo.
                </p>
              </div>
              <ModalCloseButton onClick={() => setShowGitlabActivity(false)} />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {gitlabActivities.map((act, i) => {
                const dayKey = act.createdAt.split("T")[0];
                return (
                  <div key={`${act.title}-${act.createdAt}-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2.5">
                    <div className="flex items-start gap-2">
                      <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                        act.type === "merge_request"
                          ? "text-purple-700 bg-purple-100 dark:text-purple-300 dark:bg-purple-950/40"
                          : "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-950/40"
                      }`}>
                        {act.type === "merge_request" ? "MR" : "Commit"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-900 dark:text-slate-100 truncate">{act.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                          <span>{formatDay(dayKey)}</span>
                          <span>·</span>
                          <span className="truncate">{act.project}</span>
                          {act.refIds.length > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                {act.refIds.map(id => `#${id}`).join(", ")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {act.url && (
                        <a href={act.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline">
                          abrir
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={() => setShowGitlabActivity(false)}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* I/O Inspector overlay */}
      {showInspector && debug && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/70 p-4 animate-fade-in" onClick={() => setShowInspector(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[92vh] flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Inspector de I/O da IA</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tudo o que foi enviado ao fornecedor e tudo o que ele devolveu.
                </p>
              </div>
              <ModalCloseButton onClick={() => setShowInspector(false)} />
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5">
                  <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Intervalo</p>
                  <p className="text-xs font-mono text-slate-900 dark:text-slate-100 mt-0.5">{debug.dateRange.from} → {debug.dateRange.to}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5">
                  <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Tarefas enviadas</p>
                  <p className="text-xs font-mono text-slate-900 dark:text-slate-100 mt-0.5">{debug.tasksSent}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5">
                  <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Atividade GitLab</p>
                  <p className="text-xs font-mono text-slate-900 dark:text-slate-100 mt-0.5">
                    {debug.gitlabActivityReceived !== undefined
                      ? `${debug.gitlabActivityReceived} recebidos · ${debug.gitlabActivitySent} enviados`
                      : `${debug.gitlabActivitySent} item(s)`}
                  </p>
                  {(debug.gitlabActivityDeduped !== undefined && debug.gitlabActivityReceived !== undefined && debug.gitlabActivityDeduped < debug.gitlabActivityReceived) && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                      dedup: {debug.gitlabActivityReceived}→{debug.gitlabActivityDeduped}
                      {debug.gitlabActivitySummarized ? " · resumido" : ""}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5">
                  <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Items propostos</p>
                  <p className="text-xs font-mono text-slate-900 dark:text-slate-100 mt-0.5">{items.length}</p>
                  {debug.retried && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">retry</p>
                  )}
                </div>
              </div>

              {/* Char counts strip */}
              {(debug.promptCharCount !== undefined || debug.responseCharCount !== undefined) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                  {debug.promptCharCount !== undefined && (
                    <span>Prompt: <strong className="font-mono">{(debug.promptCharCount / 1000).toFixed(1)}k chars</strong></span>
                  )}
                  {debug.responseCharCount !== undefined && (
                    <span>Resposta: <strong className="font-mono">{debug.responseCharCount} chars</strong></span>
                  )}
                  <span>Retry: <strong className="font-mono">{debug.retried ? "sim" : "nao"}</strong></span>
                </div>
              )}

              {/* System prompt */}
              <details className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20" open>
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  1. Prompt de sistema ({debug.promptSystem.length} chars)
                </summary>
                <pre className="px-3 pb-3 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{debug.promptSystem}</pre>
              </details>

              {/* User prompt (the JSON payload) */}
              <details className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20" open>
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  2. Payload enviado ({debug.promptUser.length} chars)
                </summary>
                <pre className="px-3 pb-3 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{debug.promptUser}</pre>
              </details>

              {/* Raw response */}
              <details className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20" open>
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  3. Resposta bruta ({(rawResponse || "").length} chars)
                </summary>
                <pre className="px-3 pb-3 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{rawResponse || "(vazio)"}</pre>
              </details>

              {/* Warnings */}
              {warnings && warnings.length > 0 && (
                <details className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20">
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                    Avisos do servidor ({warnings.length})
                  </summary>
                  <ul className="px-4 pb-3 text-[11px] text-rose-800 dark:text-rose-300 list-disc list-inside space-y-0.5">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <button
                onClick={async () => {
                  const dedup = debug.gitlabActivityDeduped !== undefined && debug.gitlabActivityReceived !== undefined
                    ? ` (dedup ${debug.gitlabActivityReceived}→${debug.gitlabActivityDeduped}${debug.gitlabActivitySummarized ? " resumido" : ""})`
                    : "";
                  const charStats = debug.promptCharCount !== undefined
                    ? `\nPrompt chars: ${debug.promptCharCount}\nResposta chars: ${debug.responseCharCount}\nRetry: ${debug.retried ? "sim" : "nao"}`
                    : "";
                  const text = `# Inspector\nIntervalo: ${debug.dateRange.from} → ${debug.dateRange.to}\nTarefas enviadas: ${debug.tasksSent}\nAtividade GitLab: ${debug.gitlabActivityReceived !== undefined ? `${debug.gitlabActivityReceived} recebidos · ${debug.gitlabActivitySent} enviados${dedup}` : debug.gitlabActivitySent}\nItems propostos: ${items.length}${charStats}\n\n## System\n${debug.promptSystem}\n\n## User\n${debug.promptUser}\n\n## Response\n${rawResponse || ""}`;
                  try {
                    await navigator.clipboard.writeText(text);
                    addToast("Copiado para a area de transferencia.", "success");
                  } catch {
                    addToast("Falha ao copiar (sem permissoes de clipboard).", "error");
                  }
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Copiar tudo
              </button>
              <button
                onClick={() => setShowInspector(false)}
                className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
