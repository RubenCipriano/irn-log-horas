"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { Toast, ToastType } from "@/types";

type ToastContextType = {
  toasts: Toast[];
  addToast: (message: string, type: ToastType) => void;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts(prev => {
      // Cap at 4 concurrent toasts: drop oldest when full.
      const next = [...prev, { id, message, type }];
      if (next.length > 4) {
        const dropped = next.shift();
        if (dropped) {
          const t = timers.current.get(dropped.id);
          if (t) { clearTimeout(t); timers.current.delete(dropped.id); }
        }
      }
      return next;
    });
    const timer = setTimeout(() => removeToast(id), 4000);
    timers.current.set(id, timer);
  }, [removeToast]);

  useEffect(() => {
    // Capture the ref's current Map so the cleanup uses the same instance that
    // was live when the effect ran (avoids the stale-ref cleanup warning).
    const timersMap = timers.current;
    return () => {
      timersMap.forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
