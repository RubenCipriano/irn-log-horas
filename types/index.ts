// Shared types for the IRN Log Horas application

export type TodoItem = {
  id: string;
  title: string;
  date: Date | null;
  url?: string;
  status?: string;
  sprint?: string;
  updatedAt?: string;
  isClosed?: boolean;
  activeFrom?: string | null;   // "YYYY-MM-DD" — first work status date
  activeUntil?: string | null;  // "YYYY-MM-DD" — date it became Desenvolvido/Fechada (null = still active)
};

export type Holiday = {
  name: string;
  date: Date;
};

export type SelectedDay = {
  date: Date;
  todos: TodoItem[];
  holiday?: Holiday;
  actualHours?: number;
  expectedHours?: number | null;
};

export type Recommendation = {
  taskId: string;
  taskTitle: string;
  hours: number;
};

export type SeasonSchedule = {
  monThu: number;
  fri: number;
};

export type WorkSchedule = {
  summer: SeasonSchedule;
  winter: SeasonSchedule;
  summerMonths: [number, number]; // [startMonth, endMonth) using 0-indexed months
};

export type TaskAssignment = {
  taskId: string;
  taskTitle: string;
  dayKey: string; // "YYYY-MM-DD"
};

export type TaskHistory = {
  totalHours: number;
  entryCount: number;
  lastUsed: string; // "YYYY-MM-DD"
  avgHoursPerDay: number;
};

export type TimeEntriesData = {
  byDay: Record<string, number>;
  byTask: Record<string, TaskHistory>;
  byDayTask: Record<string, Record<string, number>>;
};

export type SprintInfo = {
  id: string;
  name: string;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null;   // "YYYY-MM-DD"
};

export type SmartRecommendation = {
  taskId: string;
  taskTitle: string;
  hours: number;
  selected: boolean;
  source: "pinned" | "history" | "available";
};

export type ToastType = "success" | "error" | "warning";
export type Toast = { id: string; message: string; type: ToastType };
