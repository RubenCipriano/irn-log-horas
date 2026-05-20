"use client";

import Calendar from "@/components/Calendar";
import { useAppData } from "@/components/AppDataProvider";

// Thin adapter between the route + the data provider and the (unchanged)
// Calendar component. Both / and /kanban render this with their initial view.
export default function CalendarRoute({ initialView }: { initialView: "calendar" | "kanban" }) {
  const d = useAppData();
  if (!d.token) return null; // provider is redirecting to /setup

  return (
    <Calendar
      todoList={d.todos}
      timeEntries={d.timeEntries}
      sprints={d.sprints}
      availableStatuses={d.availableStatuses}
      isLoading={d.isLoading}
      onMonthChange={d.refresh}
      onTimeEntriesUpdate={d.setTimeEntries}
      onTodosUpdate={d.setTodos}
      authToken={d.token}
      authUrl={d.url}
      userName={d.user?.name}
      userEmail={d.user?.email}
      onLogout={d.logout}
      initialView={initialView}
    />
  );
}
