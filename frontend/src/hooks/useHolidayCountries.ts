"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HolidayCountryItem } from "@/lib/types";

type HolidayCountriesResponse = { countries: HolidayCountryItem[] };

// Available country presets for the project-policy "Holiday country"
// dropdown. Backend reads from PresetCountryMap so the SPA stays in
// sync without a hard-coded list duplicate.
export function useHolidayCountries(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["holiday-countries", orgId],
    queryFn: async () =>
      (await api.get<HolidayCountriesResponse>(
        `/api/orgs/${orgId}/policy/holiday-countries`,
      )).data.countries,
    enabled: !!orgId,
    staleTime: 60 * 60_000,
  });
}
