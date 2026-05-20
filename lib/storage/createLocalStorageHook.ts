"use client";

import { useCallback, useState } from "react";
import { readJSON, writeJSON, removeKey } from "./localStore";

type Options<T> = {
  key: string;
  fallback: T;
  // Optional validator/normalizer applied to the parsed value. Return the
  // fallback to reject a malformed stored value.
  parse?: (raw: unknown) => T;
};

// Factory for the common "one localStorage key, JSON value" hook shape.
// Returns { value, setValue, reset }. SSR-safe (reads lazily on mount).
export function createLocalStorageHook<T>({ key, fallback, parse }: Options<T>) {
  return function useStoredValue() {
    const [value, setValueState] = useState<T>(() => {
      const stored = readJSON<unknown>(key, fallback);
      if (stored === fallback) return fallback;
      return parse ? parse(stored) : (stored as T);
    });

    const setValue = useCallback((next: T) => {
      setValueState(next);
      writeJSON(key, next);
    }, []);

    const reset = useCallback(() => {
      setValueState(fallback);
      removeKey(key);
    }, []);

    return { value, setValue, reset };
  };
}
