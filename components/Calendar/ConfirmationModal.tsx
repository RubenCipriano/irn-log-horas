import type { Recommendation } from "@/types";
import { formatHours } from "@/lib/calendar-utils";

type ConfirmationModalProps = {
  date: Date;
  recommendations: Recommendation[];
  isSaving: boolean;
  onUpdateHours: (index: number, hours: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmationModal({
  date,
  recommendations,
  isSaving,
  onUpdateHours,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200 mb-2">
          Tem a certeza?
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Quer atualizar as seguintes horas para o dia{" "}
          <strong>
            {date.toLocaleDateString("pt-PT", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </strong>
          ?
        </p>

        <div className="mb-4 space-y-2 max-h-64 overflow-y-auto">
          {recommendations.map((rec, idx) => (
            <div
              key={rec.taskId}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-100 dark:bg-slate-700 p-2 text-sm"
            >
              <span className="text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">
                {rec.taskTitle}
              </span>
              <input
                type="number"
                min={0}
                max={12}
                step={0.5}
                value={rec.hours}
                onChange={(e) => onUpdateHours(idx, Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-16 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-center font-semibold text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          ))}
          <div className="flex justify-between rounded-lg bg-indigo-100 dark:bg-indigo-900 p-2 text-sm font-semibold border-2 border-indigo-300 dark:border-indigo-700">
            <span className="text-indigo-900 dark:text-indigo-100">Total</span>
            <span className="text-indigo-900 dark:text-indigo-100">
              {formatHours(recommendations.reduce((sum, r) => sum + r.hours, 0))}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            className="flex-1 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Guardando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
