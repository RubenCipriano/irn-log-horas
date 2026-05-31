"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

// Re-export so existing imports keep working — AuthUser's canonical
// shape now lives in lib/types alongside the other DTOs.
export type { AuthUser } from "@/lib/types";

async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { data } = await api.get<AuthUser>("/api/auth/me");
    return data;
  } catch (err) {
    // 401 is the "not logged in" signal — surface as null, not error.
    // Anything else (network down, 500) bubbles so the UI can show it.
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      return null;
    }
    throw err;
  }
}

export function useAuth() {
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  return {
    user: query.data ?? null,
    isAuthenticated: !!query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
