// Defensive validation for identifiers that get interpolated into outbound
// OpenProject API URLs (taskId, statusId). OpenProject is the source of truth,
// but validating here keeps malformed/path-traversal-shaped values from ever
// reaching the URL builder.

export class InvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}

// Accepts a positive integer id (string or number). Returns the canonical
// string form. Throws InvalidIdError otherwise.
export function assertNumericId(value: unknown, name = "id"): string {
  const str = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(str)) {
    throw new InvalidIdError(`${name} invalido.`);
  }
  return str;
}
