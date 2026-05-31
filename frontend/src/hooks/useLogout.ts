"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function useLogout() {
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Tolerate 401/404 — clearing local state matters even if the
      // server-side session is already gone.
      try {
        await api.post("/api/auth/logout");
      } catch {
        /* intentional */
      }
    },
    onSettled: () => {
      qc.removeQueries({ queryKey: ["auth"] });
      router.push("/login");
    },
  });
}
