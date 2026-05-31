"use client";

import type { ReactNode } from "react";
import type { AuthUser } from "@/hooks/useAuth";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export function AppShellLayout({
  user,
  currentPath,
  title,
  children,
}: {
  user: AuthUser;
  currentPath: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-(--color-bg)">
      <Sidebar user={user} currentPath={currentPath} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
