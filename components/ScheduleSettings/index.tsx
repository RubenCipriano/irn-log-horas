"use client";

import { useState } from "react";
import type { WorkSchedule } from "@/types";

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type ScheduleSettingsProps = {
  schedule: WorkSchedule;
  onSave: (schedule: WorkSchedule) => void;
  onReset: () => void;
};

export default function ScheduleSettings({ schedule, onSave, onReset }: ScheduleSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<"summer" | "winter">("summer");
  const [draft, setDraft] = useState<WorkSchedule>(schedule);

  const currentSeason = draft[selectedSeason];

  const updateSeasonHours = (field: "monThu" | "fri", value: number) => {
    setDraft(prev => ({
      ...prev,
      [selectedSeason]: {
        ...prev[selectedSeason],
        [field]: Math.max(0, Math.min(12, value)),
      },
    }));
  };

  const updateSummerMonth = (index: 0 | 1, value: number) => {
    setDraft(prev => ({
      ...prev,
      summerMonths: [
        index === 0 ? value : prev.summerMonths[0],
        index === 1 ? value : prev.summerMonths[1],
      ] as [number, number],
    }));
  };

  const handleSave = () => {
    onSave(draft);
    setIsOpen(false);
  };

  const handleReset = () => {
    onReset();
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setDraft(schedule);
          setIsOpen(true);
        }}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
      >
        Configurar Horario de Trabalho
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Horario de Trabalho
        </h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
        >
          x
        </button>
      </div>

      {/* Season selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSelectedSeason("summer")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            selectedSeason === "summer"
              ? "bg-amber-500 text-white"
              : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
          }`}
        >
          Verao
        </button>
        <button
          onClick={() => setSelectedSeason("winter")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            selectedSeason === "winter"
              ? "bg-blue-500 text-white"
              : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
          }`}
        >
          Inverno
        </button>
      </div>

      {/* Hours configuration */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <label className="text-sm text-slate-600 dark:text-slate-400">
            Seg-Qui (horas)
          </label>
          <input
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={currentSeason.monThu}
            onChange={(e) => updateSeasonHours("monThu", parseFloat(e.target.value) || 0)}
            className="w-20 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1 text-sm text-center text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-slate-600 dark:text-slate-400">
            Sexta (horas)
          </label>
          <input
            type="number"
            min={0}
            max={12}
            step={0.5}
            value={currentSeason.fri}
            onChange={(e) => updateSeasonHours("fri", parseFloat(e.target.value) || 0)}
            className="w-20 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1 text-sm text-center text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Summer month range */}
      <div className="space-y-3 mb-4 pt-3 border-t border-slate-200 dark:border-slate-700">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
          Meses de Verao
        </p>
        <div className="flex items-center gap-2">
          <select
            value={draft.summerMonths[0]}
            onChange={(e) => updateSummerMonth(0, parseInt(e.target.value))}
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {MONTHS_PT.map((month, i) => (
              <option key={i} value={i}>{month}</option>
            ))}
          </select>
          <span className="text-sm text-slate-500">ate</span>
          <select
            value={draft.summerMonths[1]}
            onChange={(e) => updateSummerMonth(1, parseInt(e.target.value))}
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {MONTHS_PT.map((month, i) => (
              <option key={i} value={i}>{month}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Atualmente: {MONTHS_PT[draft.summerMonths[0]]} a {MONTHS_PT[Math.max(0, draft.summerMonths[1] - 1)]}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="flex-1 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
        >
          Guardar
        </button>
        <button
          onClick={handleReset}
          className="rounded-lg bg-slate-200 dark:bg-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-300 dark:hover:bg-slate-600"
        >
          Repor Padrao
        </button>
      </div>
    </div>
  );
}
