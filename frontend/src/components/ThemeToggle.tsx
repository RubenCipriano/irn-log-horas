"use client";

import { useTheme, type ThemeMode } from "@/hooks/useTheme";

// Three-segment toggle: L / Auto / D. Matches the affordance the legacy
// Next.js app had so muscle memory transfers. Clicking a segment
// commits immediately + persists to localStorage.

const segments: { mode: ThemeMode; label: string; title: string }[] = [
  { mode: "light", label: "L", title: "Light" },
  { mode: "auto", label: "Auto", title: "Follow system" },
  { mode: "dark", label: "D", title: "Dark" },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center rounded-full border border-(--color-border) bg-(--color-card) p-0.5 text-[11px] font-medium"
    >
      {segments.map((s) => {
        const active = mode === s.mode;
        return (
          <button
            key={s.mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={s.title}
            onClick={() => setMode(s.mode)}
            className={
              active
                ? "rounded-full bg-indigo-600 text-white px-2.5 py-0.5"
                : "rounded-full text-(--color-muted) hover:text-(--color-fg) px-2.5 py-0.5"
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
