"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type InvoiceItem = {
  id: string;
  number: string;
  // The engagement project being invoiced (Client was collapsed into
  // Project). `projectName` reflects the billed-party snapshot taken at
  // generation time, so project renames don't rewrite history.
  projectId: string;
  projectName: string;
  periodFrom: string;
  periodTo: string;
  status: "draft" | "sent" | "paid" | "void";
  subtotal: number;
  taxPct: number;
  taxAmount: number;
  total: number;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

// Quantity unit + cadence travel together on every line. Legacy lines
// (pre-cadence) are backfilled to ('hours', 'hourly'), so these are
// safe to treat as always-present on the client even though the
// migration adds the columns as nullable first.
export type QuantityUnit = "hours" | "days" | "months";
export type LineCadence = "hourly" | "daily" | "monthly";

export type InvoiceLineItem = {
  id: string;
  worklogId: string | null;
  description: string;
  hours: number;
  billRate: number;
  amount: number;
  ordinal: number;
  quantity: number;
  quantityUnit: QuantityUnit;
  cadence: LineCadence;
};

export type InvoiceDetail = InvoiceItem & {
  notes: string | null;
  updatedAt: string;
  lines: InvoiceLineItem[];
};

export type PreviewLine = {
  worklogId: string | null;
  description: string;
  hours: number;
  billRate: number;
  amount: number;
  quantity: number;
  quantityUnit: QuantityUnit;
  cadence: LineCadence;
};

export type PreviewResponse = {
  projectId: string;
  billedPartyName: string;
  currency: string;
  periodFrom: string;
  periodTo: string;
  taxPct: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  lines: PreviewLine[];
  warnings: string[];
};

// Member-target preview adds member identity + the list of clients the
// member's worklogs touched in the window. When `multipleClients` is
// true the UI must collect a clientId before /from-member will succeed.
export type MemberPreviewResponse = PreviewResponse & {
  memberId: string;
  memberName: string;
  candidateClientIds: string[];
  candidateClients?: { id: string; name: string }[];
  multipleClients: boolean;
};

export function useInvoices(
  orgId: string | null | undefined,
  filters: { status?: string; projectId?: string; skip?: number; take?: number } = {},
) {
  return useQuery({
    queryKey: ["invoices", orgId, filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (filters.status) params.status = filters.status;
      if (filters.projectId) params.projectId = filters.projectId;
      if (filters.skip) params.skip = filters.skip;
      if (filters.take) params.take = filters.take;
      return (await api.get<{ total: number; items: InvoiceItem[] }>(
        `/api/orgs/${orgId}/invoices`,
        { params },
      )).data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}

export function useInvoice(orgId: string | null | undefined, invoiceId: string | null | undefined) {
  return useQuery({
    queryKey: ["invoices", orgId, "detail", invoiceId],
    queryFn: async () =>
      (await api.get<InvoiceDetail>(`/api/orgs/${orgId}/invoices/${invoiceId}`)).data,
    enabled: !!orgId && !!invoiceId,
    staleTime: 15_000,
  });
}

export type GenerateBody = {
  projectId: string;
  periodFrom: string;
  periodTo: string;
  taxPct?: number;
  notes?: string;
};

export function usePreviewInvoice(orgId: string | null | undefined) {
  return useMutation({
    mutationFn: async (body: GenerateBody) =>
      (await api.post<PreviewResponse>(`/api/orgs/${orgId}/invoices/preview`, body)).data,
  });
}

export function useGenerateInvoice(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: GenerateBody) =>
      (await api.post<{ id: string; number: string; total: number }>(
        `/api/orgs/${orgId}/invoices/generate`,
        body,
      )).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices", orgId] }),
  });
}

export function useUpdateInvoice(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, body }: {
      invoiceId: string;
      body: Partial<{
        status: string; notes: string; issuedAt: string; dueAt: string; paidAt: string; taxPct: number;
      }>;
    }) =>
      (await api.patch(`/api/orgs/${orgId}/invoices/${invoiceId}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useDeleteInvoice(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) =>
      (await api.delete(`/api/orgs/${orgId}/invoices/${invoiceId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export type MemberGenerateBody = {
  userId: string;
  periodFrom: string;
  periodTo: string;
  projectId?: string;
  clientId?: string;
  taxPct?: number;
  notes?: string;
};

export function usePreviewInvoiceForMember(orgId: string | null | undefined) {
  return useMutation({
    mutationFn: async (body: MemberGenerateBody) =>
      (
        await api.post<MemberPreviewResponse>(
          `/api/orgs/${orgId}/invoices/preview-for-member`,
          body,
        )
      ).data,
  });
}

export function useGenerateInvoiceFromMember(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MemberGenerateBody) =>
      (
        await api.post<{ id: string; number: string; total: number }>(
          `/api/orgs/${orgId}/invoices/from-member`,
          body,
        )
      ).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices", orgId] }),
  });
}
