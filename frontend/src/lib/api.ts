import axios from "axios";

// Centralised axios client. Two pieces of config matter:
//
//   1. baseURL — `NEXT_PUBLIC_API_BASE_URL` set at build/dev time. Falls
//      back to '' (same-origin) so the SPA also works behind a future
//      reverse proxy that puts both services on one host. Local dev:
//      the backend lives on http://localhost:5001.
//
//   2. withCredentials — required because auth lives in an HTTP-only
//      cookie that the backend sets. Without this, axios omits cookies
//      on cross-origin requests and every authed call would 401.
//
// Backend CORS must mirror this: AllowCredentials + explicit origin
// (no wildcard with credentials). See backend/TimeFlow.Api/Program.cs.

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const api = axios.create({
  baseURL,
  withCredentials: true,
});
