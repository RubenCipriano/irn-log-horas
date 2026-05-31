"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { CurrentOrgProvider } from "@/hooks/useCurrentOrgId";
import { CurrentProjectProvider } from "@/hooks/useCurrentProjectId";
import { ThemeContext, useThemeState } from "@/hooks/useTheme";
import { I18nProvider } from "@/components/I18nProvider";

// Client-side providers. Kept thin so the server-rendered tree above it
// (root layout, static pages) stays free of client boundaries.
//
// `useState(() => new QueryClient(...))` ensures we get ONE QueryClient
// per browser session — React StrictMode double-invokes the lambda but
// `useState`'s lazy init guards against creating a second one.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5_000,
      },
    },
  }));
  const theme = useThemeState();

  return (
    <I18nProvider>
      <ThemeContext.Provider value={theme}>
        <QueryClientProvider client={queryClient}>
          <CurrentOrgProvider>
            <CurrentProjectProvider>{children}</CurrentProjectProvider>
          </CurrentOrgProvider>
        </QueryClientProvider>
      </ThemeContext.Provider>
    </I18nProvider>
  );
}
