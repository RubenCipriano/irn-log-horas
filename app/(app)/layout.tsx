"use client";

import { AppDataProvider } from "@/components/AppDataProvider";

// Layout for the authenticated app shell. Holds the data provider so navigating
// between / (calendar) and /kanban keeps the loaded data — no refetch on view
// switch. /setup lives outside this group, so logging in/out crosses this
// boundary and re-initializes the provider with the fresh token.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppDataProvider>{children}</AppDataProvider>;
}
