import type { TodoItem } from "@/types";

type TaskModalProps = {
  todo: TodoItem;
  onClose: () => void;
};

export default function TaskModal({ todo, onClose }: TaskModalProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 w-full max-w-md border border-slate-200 dark:border-slate-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-200">
            {todo.title}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold"
          >
            x
          </button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          {todo.date?.toLocaleDateString("pt-PT") ?? "Sem data"}
        </p>
        {todo.status && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Status: {todo.status}
          </p>
        )}
      </div>
    </div>
  );
}
