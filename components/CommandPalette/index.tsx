"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (description: string, range: "day" | "week" | "month") => void;
  onCancel?: () => void;
  isProcessing: boolean;
  defaultRange?: "day" | "week" | "month";
  defaultText?: string;
  hasAIConfigured: boolean;
  hasGitLabConfigured: boolean;
  onOpenSettings: () => void;
  processingStage?: "idle" | "gitlab" | "ai" | "parse";
  processingDetail?: string;
  processingStartedAt?: number | null;
  anchorDate?: Date | null;
};

const GITLAB_PROMPT = "Analisa a minha atividade no GitLab no intervalo dado (commits + MRs) e propoe horas. Para cada commit/MR: se mencionar #ID, associa diretamente; caso contrario, escolhe a tarefa mais provavel comparando o titulo do commit com os titulos das tarefas. Distribui as horas pelos dias em que houve atividade real, respeitando o limite diario do horario.";

const SUGGESTIONS = [
  "Trabalhei nos Documentos Compostos esta semana",
  "Hoje fiz code review e meetings",
  "Esta semana fiz a feature de autenticacao e bugs do form de registo",
];

export default function CommandPalette(props: Props) {
  if (!props.open) return null;
  // Keyed remount on open ensures local state initialises from props each time
  // the palette is opened — avoids the setState-in-effect anti-pattern.
  return <CommandPaletteInner key={`${props.defaultText ?? ""}|${props.defaultRange ?? "week"}`} {...props} />;
}

function CommandPaletteInner({
  onClose, onSubmit, onCancel, isProcessing, defaultRange = "week", defaultText, hasAIConfigured, hasGitLabConfigured, onOpenSettings,
  processingStage, processingDetail, processingStartedAt, anchorDate,
}: Omit<Props, "open">) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isProcessing || !processingStartedAt) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - processingStartedAt);
    const t = setInterval(() => setElapsedMs(Date.now() - processingStartedAt), 200);
    return () => clearInterval(t);
  }, [isProcessing, processingStartedAt]);
  const [text, setText] = useState(defaultText || "");
  const [range, setRange] = useState<"day" | "week" | "month">(defaultRange);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    if (defaultText && textareaRef.current) {
      textareaRef.current.setSelectionRange(defaultText.length, defaultText.length);
    }
    // run once on mount (keyed remount handles re-init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    if (!text.trim() || isProcessing) return;
    onSubmit(text.trim(), range);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 animate-slide-up overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-indigo-500">
            <path d="M2 4l3 8 2-4 4-2-9-2zM10 10l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Assistente IA</h2>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Descreve o que fizeste e a IA distribui horas</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <kbd className="text-[10px] font-mono">esc</kbd>
          </button>
        </div>

        {!hasAIConfigured ? (
          <div className="p-6 text-center">
            <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
              Ainda nao configuraste um fornecedor de IA.
            </p>
            <button
              onClick={() => { onClose(); onOpenSettings(); }}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
            >
              Abrir definicoes
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
              Suporta Gemini, Groq, OpenRouter, Ollama e endpoints OpenAI-compativeis.
            </p>
          </div>
        ) : (
          <>
            {anchorDate && (
              <div className="px-4 pt-3">
                <div className="flex items-center gap-2 rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-indigo-600 dark:text-indigo-400 shrink-0">
                    <rect x="2" y="3.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 6.5h12M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase font-semibold tracking-wide text-indigo-700 dark:text-indigo-300">A perguntar sobre</p>
                    <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100 capitalize truncate">
                      {anchorDate.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 shrink-0">
                    {range === "day" ? "este dia" : range === "week" ? "esta semana" : "este mes"}
                  </span>
                </div>
              </div>
            )}

            {hasGitLabConfigured && (
              <div className="px-4 pt-3">
                <button
                  onClick={() => onSubmit(GITLAB_PROMPT, range)}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/30 px-3 py-2.5 transition hover:bg-orange-100 dark:hover:bg-orange-950/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-orange-600 dark:text-orange-400">
                      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78L4.69 2.6c.1-.32.41-.54.75-.54s.65.22.75.54l2.42 7.07h8.78l2.42-7.07c.1-.32.41-.54.75-.54s.65.22.75.54l2.42 7.07 1.22 3.78c.13.36-.04.74-.3.94" fill="currentColor" />
                    </svg>
                    <div className="text-left min-w-0">
                      <p className="text-sm font-semibold text-orange-900 dark:text-orange-200">Verificar os meus commits</p>
                      <p className="text-[11px] text-orange-700 dark:text-orange-400/80 truncate">
                        A IA analisa commits/MRs {
                          anchorDate
                            ? range === "day" ? "desse dia" : range === "week" ? "dessa semana" : "desse mes"
                            : range === "day" ? "de hoje" : range === "week" ? "desta semana" : "deste mes"
                        } e propoe horas. Escolhe o intervalo abaixo. Nada e guardado sem confirmares.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-950/60 px-2 py-1 rounded shrink-0">
                    GitLab · {range === "day" ? "dia" : range === "week" ? "semana" : "mes"}
                  </span>
                </button>
              </div>
            )}

            {isProcessing && (
              <ProcessingPanel
                stage={processingStage || "idle"}
                detail={processingDetail || ""}
                elapsedMs={elapsedMs}
                hasGitLab={hasGitLabConfigured}
              />
            )}

            <div className="p-4">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ex: trabalhei nos Documentos Compostos esta semana, mais 2h em code review na sexta"
                className="w-full min-h-[100px] resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--surface-2)] dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />

              {!text && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">Sugestoes</p>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => setText(s)}
                      className="block w-full text-left text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-2 py-1 transition"
                    >
                      → {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <span className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Intervalo:</span>
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                {(["day", "week", "month"] as const).map(r => {
                  const label = anchorDate
                    ? r === "day" ? "Esse dia" : r === "week" ? "Essa semana" : "Esse mes"
                    : r === "day" ? "Hoje" : r === "week" ? "Esta semana" : "Este mes";
                  return (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-3 py-1 text-xs font-medium transition ${
                        range === r
                          ? "bg-indigo-500 text-white"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1" />

              {isProcessing && onCancel ? (
                <button
                  onClick={onCancel}
                  className="rounded-lg bg-rose-500 hover:bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition flex items-center gap-1.5"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <rect x="3.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  Cancelar
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!text.trim() || isProcessing}
                  className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isProcessing ? (
                    <>
                      <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      A processar...
                    </>
                  ) : (
                    <>
                      Gerar
                      <kbd className="rounded border border-white/30 px-1 text-[9px] font-mono">⌘↵</kbd>
                    </>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProcessingPanel({
  stage, detail, elapsedMs, hasGitLab,
}: {
  stage: "idle" | "gitlab" | "ai" | "parse";
  detail: string;
  elapsedMs: number;
  hasGitLab: boolean;
}) {
  const seconds = Math.floor(elapsedMs / 1000);
  const tenths = Math.floor((elapsedMs % 1000) / 100);
  const elapsedLabel = `${seconds}.${tenths}s`;

  // Order: gitlab (optional) → ai → parse
  const steps: Array<{ key: "gitlab" | "ai" | "parse"; label: string }> = [];
  if (hasGitLab) steps.push({ key: "gitlab", label: "Obter atividade GitLab" });
  steps.push({ key: "ai", label: "Consultar IA" });
  steps.push({ key: "parse", label: "Validar e processar" });

  const stageOrder: Record<typeof stage, number> = { idle: -1, gitlab: 0, ai: hasGitLab ? 1 : 0, parse: hasGitLab ? 2 : 1 };
  const currentIndex = stageOrder[stage];

  const showSlowHint = stage === "ai" && elapsedMs > 5000;

  return (
    <div className="px-4 pt-3">
      <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">A processar</p>
          </div>
          <span className="text-[11px] font-mono text-indigo-700 dark:text-indigo-300">{elapsedLabel}</span>
        </div>

        <ol className="space-y-1.5">
          {steps.map((step, idx) => {
            const isDone = currentIndex > idx;
            const isActive = currentIndex === idx;
            return (
              <li key={step.key} className="flex items-center gap-2">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold shrink-0 ${
                    isDone
                      ? "bg-emerald-500 text-white"
                      : isActive
                        ? "bg-indigo-500 text-white"
                        : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {isDone ? "✓" : idx + 1}
                </span>
                <span className={`text-xs ${isActive ? "text-slate-900 dark:text-slate-100 font-medium" : isDone ? "text-slate-500 dark:text-slate-400 line-through" : "text-slate-500 dark:text-slate-400"}`}>
                  {step.label}
                </span>
                {isActive && (
                  <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 italic truncate">{detail}</span>
                )}
              </li>
            );
          })}
        </ol>

        {showSlowHint && (
          <p className="mt-2 pt-2 border-t border-indigo-200 dark:border-indigo-900/60 text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
            Modelos gratuitos podem demorar 5-30s. Se demorar muito, tenta um modelo mais rapido (ex. Groq) ou um intervalo mais curto.
          </p>
        )}
      </div>
    </div>
  );
}
