// Shared types for the IRN Log Horas application

export type StatusSegment = {
  status: string;          // original case, e.g. "Em Desenvolvimento"
  statusLower: string;     // normalized lowercase for lookup
  fromDate: string;        // "YYYY-MM-DD" inclusive
  toDate: string | null;   // "YYYY-MM-DD" inclusive, null = open-ended (current status)
  inferred?: boolean;      // true if synthesized to fill a Novo → Desenvolvido gap
};

// Inference config for filling Novo → terminal gaps with a synthetic active-dev segment.
export type TimelineInferenceConfig = {
  enabled: boolean;
  starterStates: string[];   // lowercase: ["novo", "new"]
  terminalStates: string[];  // lowercase: ["desenvolvido", "developed", "fechado", "closed"]
  fillState: string;         // status label used for the synthetic segment
};

export const DEFAULT_TIMELINE_INFERENCE: TimelineInferenceConfig = {
  enabled: true,
  starterStates: ["novo", "new"],
  terminalStates: ["fechado", "closed"],
  fillState: "Em Desenvolvimento",
};

export type TaskStatusTimeline = {
  taskId: string;
  segments: StatusSegment[]; // ordered ascending by fromDate
};

// Status name (lowercase) -> weight in [0, 1]
// 1.0 = full hours; 0 = excluded (terminal/blocked)
export type StatusWeightConfig = Record<string, number>;

export type TodoItem = {
  id: string;
  title: string;
  date: Date | null;
  url?: string;
  status?: string;
  statusId?: string;           // OpenProject status ID, needed for PATCH status changes
  lockVersion?: number;        // optimistic-locking field required by OpenProject PATCH
  sprint?: string;
  updatedAt?: string;
  isClosed?: boolean;
  activeFrom?: string | null;   // "YYYY-MM-DD" — derived from timeline for back-compat
  activeUntil?: string | null;  // "YYYY-MM-DD" — derived from timeline for back-compat
  timeline?: TaskStatusTimeline; // full status history (optional for old callers)
};

// One entry per OpenProject status, fetched once via /api/v3/statuses on login.
// Used to populate the status dropdown in TaskModal and the column list in Kanban.
export type AvailableStatus = {
  id: string;
  name: string;
  isClosed: boolean;
  color?: string;   // hex string when provided by OpenProject
  position?: number;
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
  source: "pinned" | "available" | "activity";
};

export type ToastType = "success" | "error" | "warning";
export type Toast = { id: string; message: string; type: ToastType };

// AI provider configuration (persisted in localStorage)
export type AIProviderConfig =
  | { kind: "gemini"; apiKey: string; model?: string }
  | { kind: "groq"; apiKey: string; model?: string }
  | { kind: "ollama"; baseUrl: string; model: string }
  | { kind: "openrouter"; apiKey: string; model: string }
  | { kind: "openai-compat"; baseUrl: string; apiKey?: string; model: string; headers?: Record<string, string> }
  | { kind: "anthropic"; apiKey: string; model?: string };

export type AIDistributionItem = {
  taskId: string;
  taskTitle: string;
  dayKey: string;
  hours: number;
  reason: string;
  source?: "ai" | "gitlab" | "history" | "manual";
  // 0..1 — how confident the AI / orchestrator is about this entry.
  // Optional: older responses / older items may not have it.
  confidence?: number;
};

export type GitLabConfig = {
  baseUrl: string;       // e.g. https://gitlab.justica.gov.pt
  accessToken: string;
  username?: string;     // resolved from /user endpoint, cached locally
};

export type GitLabActivity = {
  type: "commit" | "merge_request";
  title: string;
  project: string;
  createdAt: string;     // ISO 8601
  refIds: string[];      // OpenProject task IDs parsed from title/branch (e.g. ["32227"])
  url: string;
};
