// Minimal validation for user-supplied external base URLs (OpenProject /
// GitLab), both sourced from localStorage and used to build outbound fetch
// URLs. Per the agreed threat model (single-user, self-hosted gov app whose
// OpenProject host IS internal), we do NOT block private/loopback ranges or
// use an allowlist — that would risk bricking a legitimate internal deploy.
// We only enforce that the value is a well-formed http(s) URL, which blocks
// the worst foot-guns (file:, ftp:, garbage) before any credentialed fetch.

export class InvalidExternalUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExternalUrlError";
  }
}

// Parse + validate. Returns a normalized origin string (no trailing slash).
// Throws InvalidExternalUrlError on anything that isn't a well-formed
// http(s) URL.
export function assertValidExternalUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new InvalidExternalUrlError("URL em falta ou vazio.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new InvalidExternalUrlError("URL mal formado.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidExternalUrlError(`Protocolo nao permitido: ${parsed.protocol}`);
  }
  // Return the href without a trailing slash so callers can append paths.
  return parsed.href.replace(/\/$/, "");
}
