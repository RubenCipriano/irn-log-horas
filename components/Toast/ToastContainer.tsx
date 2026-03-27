"use client";

import { useToast } from "./ToastContext";

const typeStyles = {
  success: "bg-green-600",
  error: "bg-red-600",
  warning: "bg-amber-600",
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${typeStyles[toast.type]} text-white rounded-lg shadow-lg px-4 py-3 flex items-start gap-2 animate-toast-enter`}
        >
          <p className="flex-1 text-sm">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-white/80 hover:text-white text-lg leading-none font-bold shrink-0"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
