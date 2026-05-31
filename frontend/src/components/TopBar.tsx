"use client";

import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="h-14 shrink-0 border-b border-(--color-border) bg-(--color-card) flex items-center justify-between px-5 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-sm font-semibold text-(--color-fg) truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <ProjectSwitcher />
        <OrgSwitcher />
        <div className="h-5 w-px bg-(--color-border)" />
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs text-(--color-muted) hover:text-(--color-fg) px-2 py-1 rounded-md hover:bg-(--color-bg) transition-colors"
          title="Reload"
        >
          ↻
        </button>
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
