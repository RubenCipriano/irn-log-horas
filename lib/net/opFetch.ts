// Client-side wrapper for the same-origin OpenProject proxy routes. Dedupes the
// repeated "auth header + JSON body + parse + ok check" block used across the
// Calendar, Kanban, and TaskModal write paths.

export type OpFetchResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

type OpFetchOptions = {
  authToken: string;
  authUrl: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function opFetch<T = unknown>(path: string, opts: OpFetchOptions): Promise<OpFetchResult<T>> {
  const { authToken, authUrl, method = "POST", body, signal } = opts;
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      "X-OpenProject-URL": authUrl,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}
