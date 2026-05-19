"use client";

import { useEffect } from "react";

export type ShortcutHandlers = {
  onPalette?: () => void;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  onToday?: () => void;
  onMonthFill?: () => void;
  onWeekFill?: () => void;
  onSettings?: () => void;
  onEscape?: () => void;
};

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      const editable = isEditableTarget(e.target);
      const meta = e.metaKey || e.ctrlKey;

      // Always-on shortcuts even inside inputs
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handlers.onPalette?.();
        return;
      }
      if (e.key === "Escape") {
        handlers.onEscape?.();
        return;
      }

      if (editable) return;

      switch (e.key) {
        case "ArrowLeft":
          handlers.onPrevMonth?.();
          break;
        case "ArrowRight":
          handlers.onNextMonth?.();
          break;
        case "t":
        case "T":
          handlers.onToday?.();
          break;
        case "m":
        case "M":
          handlers.onMonthFill?.();
          break;
        case "w":
        case "W":
          handlers.onWeekFill?.();
          break;
        case "s":
        case "S":
          handlers.onSettings?.();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);
}
