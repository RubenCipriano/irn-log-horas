"use client";

import { MONTHS_PT } from "@/lib/calendar-utils";
import type { Theme } from "@/hooks/useTheme";

type Props = {
  year: number;
  month: number; // 0-indexed
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPalette: () => void;
  onSettings: () => void;
  onWeekFill: () => void;
  onMonthFill: () => void;
  onClearMonth: () => void;
  onReload: () => void;
  isReloading?: boolean;
  isLoading?: boolean;
  theme: Theme;
  onCycleTheme: () => void;
  view?: "calendar" | "kanban";
  onSetView?: (view: "calendar" | "kanban") => void;
};

function IconBtn({
  onClick, title, disabled, children,
}: { onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      {children}
    </button>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 14h6M8 11.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function TopBar({
  year, month, onPrev, onNext, onToday, onPalette, onSettings,
  onWeekFill, onMonthFill, onClearMonth, onReload, isReloading, isLoading,
  theme, onCycleTheme, view = "calendar", onSetView,
}: Props) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-[var(--surface-1)]/85 dark:bg-slate-900/85 border-b border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* Month nav */}
        <div className="flex items-center gap-1">
          <IconBtn onClick={onPrev} title="Mes anterior (←)" disabled={isLoading}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
          <button
            onClick={onToday}
            disabled={isLoading}
            title="Hoje (T)"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40"
          >
            Hoje
          </button>
          <IconBtn onClick={onNext} title="Mes seguinte (→)" disabled={isLoading}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </IconBtn>
          <h1 className="ml-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            {isLoading ? (
              <span className="inline-block h-5 w-32 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
            ) : (
              <>{MONTHS_PT[month]} <span className="text-slate-400 dark:text-slate-500 font-normal">{year}</span></>
            )}
          </h1>
        </div>

        <div className="flex-1" />

        {/* View toggle: Calendar / Kanban */}
        {onSetView && (
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5 mr-1">
            <button
              onClick={() => onSetView("calendar")}
              title="Vista de calendario"
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                view === "calendar"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              Calendario
            </button>
            <button
              onClick={() => onSetView("kanban")}
              title="Vista de Kanban"
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                view === "kanban"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              Kanban
            </button>
          </div>
        )}

        {/* Quick actions — calendar-specific, hidden in Kanban view */}
        {view !== "kanban" && (
          <>
            <button
              onClick={onWeekFill}
              disabled={isLoading}
              title="Preencher semana (W)"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40"
            >
              Semana
            </button>
            <button
              onClick={onMonthFill}
              disabled={isLoading}
              title="Preencher mes (M)"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-40"
            >
              Mes
            </button>
            <button
              onClick={onClearMonth}
              disabled={isLoading}
              title="Limpar horas"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition disabled:opacity-40"
            >
              Limpar
            </button>
          </>
        )}

        <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Palette */}
        <button
          onClick={onPalette}
          title="Comando rapido (Ctrl+K)"
          className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>IA</span>
          <kbd className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono">
            ⌘K
          </kbd>
        </button>

        <button
          onClick={onCycleTheme}
          title={`Tema actual: ${theme === "light" ? "Claro" : theme === "dark" ? "Escuro" : "Sistema"}. Clica para alternar.`}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
        >
          <ThemeIcon theme={theme} />
          <span className="hidden sm:inline">{theme === "light" ? "Claro" : theme === "dark" ? "Escuro" : "Auto"}</span>
        </button>

        <IconBtn onClick={onReload} title="Recarregar" disabled={isReloading}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={isReloading ? "animate-spin" : ""}>
            <path d="M2 8a6 6 0 0 1 10.5-4M14 8a6 6 0 0 1-10.5 4M12.5 4H10.5V2M3.5 12h2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconBtn>

        <IconBtn onClick={onSettings} title="Definicoes (S)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2L3.4 12.6M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </IconBtn>
      </div>
    </header>
  );
}
