"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { WorkSchedule, StatusWeightConfig, TaskStatusTimeline, AIProviderConfig, GitLabConfig } from "@/types";
import type { Theme } from "@/hooks/useTheme";
import ScheduleSettings from "@/components/ScheduleSettings";
import StatusWeightSettings from "@/components/StatusWeightSettings";
import ModalCloseButton from "@/components/ModalCloseButton";

type TabKey = "appearance" | "schedule" | "weights" | "inference" | "kanban" | "ai" | "gitlab" | "meetings";

type Props = {
  open: boolean;
  onClose: () => void;
  schedule: WorkSchedule;
  onScheduleSave: (s: WorkSchedule) => void;
  onScheduleReset: () => void;
  timelines: Record<string, TaskStatusTimeline>;
  statusWeights: StatusWeightConfig;
  overrides: StatusWeightConfig;
  setWeight: (k: string, v: number) => void;
  resetWeight: (k: string) => void;
  resetAllWeights: () => void;
  meetingsTaskId: string;
  setMeetingsTaskId: (v: string) => void;
  saveMeetingsTaskId: () => void;
  meetingsHours: number;
  setMeetingsHours: (h: number) => void;
  aiConfig: AIProviderConfig | null;
  aiSettingsSlot: ReactNode;
  gitlabConfig: GitLabConfig | null;
  gitlabSettingsSlot: ReactNode;
  inferenceSettingsSlot: ReactNode;
  kanbanSettingsSlot: ReactNode;
  theme: Theme;
  setTheme: (t: Theme) => void;
};

export default function SettingsDrawer({
  open,
  onClose,
  schedule,
  onScheduleSave,
  onScheduleReset,
  timelines,
  statusWeights,
  overrides,
  setWeight,
  resetWeight,
  resetAllWeights,
  meetingsTaskId,
  setMeetingsTaskId,
  saveMeetingsTaskId,
  meetingsHours,
  setMeetingsHours,
  aiConfig,
  aiSettingsSlot,
  gitlabConfig,
  gitlabSettingsSlot,
  inferenceSettingsSlot,
  kanbanSettingsSlot,
  theme,
  setTheme,
}: Props) {
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "appearance";
    const saved = localStorage.getItem("settings_last_tab_v1");
    if (saved === "appearance" || saved === "schedule" || saved === "weights" || saved === "inference" || saved === "kanban" || saved === "ai" || saved === "gitlab" || saved === "meetings") return saved;
    return "appearance";
  });

  const handleSetTab = (next: TabKey) => {
    setTab(next);
    try { localStorage.setItem("settings_last_tab_v1", next); } catch { /* ignore */ }
  };

  if (!open) return null;

  const tabs: { key: TabKey; label: string; badge?: string }[] = [
    { key: "appearance", label: "Aspeto" },
    { key: "schedule", label: "Horario" },
    { key: "weights", label: "Pesos" },
    { key: "inference", label: "Inferencia" },
    { key: "kanban", label: "Kanban" },
    { key: "ai", label: "IA", badge: aiConfig ? aiConfig.kind : undefined },
    { key: "gitlab", label: "GitLab", badge: gitlabConfig ? "on" : undefined },
    { key: "meetings", label: "Meetings" },
  ];

  return (
    <div className="fixed inset-0 z-40 animate-fade-in" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-[var(--surface-1)] dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col animate-slide-in-right shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Definicoes</h2>
          <ModalCloseButton onClick={onClose} ariaLabel="Fechar definicoes" />
        </div>

        <div className="flex gap-0.5 px-2 pt-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto scrollbar-thin">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => handleSetTab(t.key)}
              className={`relative px-2.5 py-2 text-sm font-medium transition rounded-t-lg whitespace-nowrap shrink-0 ${
                tab === t.key
                  ? "text-indigo-600 dark:text-indigo-400 bg-slate-50 dark:bg-slate-800"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <span>{t.label}</span>
                {t.badge && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={t.badge} />
                )}
              </span>
              {tab === t.key && (
                <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-indigo-500" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "appearance" && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Tema</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Escolhe o aspeto do calendario. &quot;Sistema&quot; segue a preferencia do teu sistema operativo.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["light", "dark", "system"] as const).map(opt => {
                  const label = opt === "light" ? "Claro" : opt === "dark" ? "Escuro" : "Sistema";
                  const active = theme === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setTheme(opt)}
                      className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                      }`}
                    >
                      {opt === "light" && (
                        <div className="h-12 w-full rounded-md bg-white border border-slate-200 flex items-center justify-center">
                          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-amber-500">
                            <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </div>
                      )}
                      {opt === "dark" && (
                        <div className="h-12 w-full rounded-md bg-slate-900 border border-slate-700 flex items-center justify-center">
                          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-slate-300">
                            <path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                      {opt === "system" && (
                        <div className="h-12 w-full rounded-md bg-gradient-to-r from-white to-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-slate-500">
                            <rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M5 14h6M8 11.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </div>
                      )}
                      <span className={`text-xs font-medium ${active ? "text-indigo-700 dark:text-indigo-300" : "text-slate-700 dark:text-slate-300"}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-700">
                Tambem podes alternar rapidamente no botao do topo da pagina (ao lado das definicoes).
              </p>
            </div>
          )}

          {tab === "schedule" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Define as horas esperadas por dia da semana, separadas por estacao.
              </p>
              <ScheduleSettings schedule={schedule} onSave={onScheduleSave} onReset={onScheduleReset} />
            </div>
          )}

          {tab === "weights" && (
            <StatusWeightSettings
              timelines={timelines}
              weights={statusWeights}
              overrides={overrides}
              setWeight={setWeight}
              resetWeight={resetWeight}
              reset={resetAllWeights}
            />
          )}

          {tab === "inference" && (
            <div>{inferenceSettingsSlot}</div>
          )}

          {tab === "kanban" && (
            <div>{kanbanSettingsSlot}</div>
          )}

          {tab === "ai" && (
            <div>
              {aiSettingsSlot}
            </div>
          )}

          {tab === "gitlab" && (
            <div>
              {gitlabSettingsSlot}
            </div>
          )}

          {tab === "meetings" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                  ID da Task de Meetings
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Esta task sera adicionada automaticamente em todos os dias uteis na distribuicao (manual e IA).
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={meetingsTaskId}
                    onChange={(e) => setMeetingsTaskId(e.target.value)}
                    placeholder="Ex: 12345"
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    onClick={saveMeetingsTaskId}
                    className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
                  >
                    Guardar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                  Horas de meetings por dia
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Quantas horas reservar para meetings em cada dia util. 0 para desligar.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={8}
                    step={0.5}
                    value={meetingsHours}
                    onChange={(e) => setMeetingsHours(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-center text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {meetingsHours === 0 ? "Meetings desactivado" : `${meetingsHours}h por dia util`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
