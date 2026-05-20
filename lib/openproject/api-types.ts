// Minimal interface fragments for the OpenProject API v3 responses we touch.
// Only the fields we actually read are typed; everything else stays untyped via
// optional/loose shapes. These exist to remove `any` at the route boundary.

export type OpLink = { href?: string; title?: string };

export type OpWorkPackage = {
  id: number | string;
  subject?: string;
  startDate?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lockVersion?: number;
  _links?: {
    self?: OpLink;
    status?: OpLink;
    version?: OpLink;
  };
  _embedded?: {
    status?: { name?: string };
  };
};

export type OpStatus = {
  id?: number | string;
  name?: string;
  isClosed?: boolean;
  color?: string;
  position?: number;
};

export type OpActivityDetail = Record<string, unknown>;

export type OpActivityEntry = {
  createdAt?: string;
  comment?: { raw?: string; html?: string };
  note?: string;
  details?: OpActivityDetail[];
  _embedded?: { details?: OpActivityDetail[] };
};

export type OpTimeEntry = {
  id?: number | string;
  hours?: string;
  spentOn?: string;
  _links?: {
    workPackage?: OpLink;
  };
};

export type OpVersion = {
  id?: number | string;
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
  _links?: { self?: OpLink };
};

export type OpUser = {
  id: number | string;
  name?: string;
  email?: string;
};

export type OpCollection<T> = {
  total?: number;
  count?: number;
  _embedded?: { elements?: T[] };
};
