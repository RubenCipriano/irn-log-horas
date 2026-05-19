"use client";

import { useState } from "react";
import type { ReactNode } from "react";

type Props = {
  sidebar: ReactNode;
  topBar: ReactNode;
  drawer?: ReactNode;
  children: ReactNode;
};

export default function AppShell({ sidebar, topBar, drawer, children }: Props) {
  // sidebar visibility on mobile
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--surface-2)] dark:bg-slate-950">
      {/* Sidebar — hidden on mobile until toggled */}
      <div className={`${mobileSidebarOpen ? "fixed inset-0 z-40 flex" : "hidden"} md:flex md:relative md:z-auto md:h-full`}>
        {mobileSidebarOpen && (
          <div className="absolute inset-0 bg-black/40 md:hidden" onClick={() => setMobileSidebarOpen(false)} />
        )}
        <div className="relative z-50 h-full flex">
          {sidebar}
        </div>
      </div>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {topBar}
        <main className="flex-1 overflow-y-auto">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden fixed bottom-4 left-4 z-30 rounded-full bg-indigo-500 p-3 text-white shadow-lg"
            aria-label="Abrir menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {children}
        </main>
      </div>

      {drawer}
    </div>
  );
}
