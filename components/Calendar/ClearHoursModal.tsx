type ClearHoursModalProps = {
  date: Date;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ClearHoursModal({
  date,
  isSaving,
  onConfirm,
  onCancel,
}: ClearHoursModalProps) {
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
          Apagar Horas
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Quer apagar todas as horas registadas no dia{" "}
          <strong>
            {date.toLocaleDateString("pt-PT", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </strong>
          ?
        </p>

        <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-200">
            Esta acao nao pode ser desfeita.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Apagando..." : "Apagar Horas"}
          </button>
        </div>
      </div>
    </div>
  );
}
