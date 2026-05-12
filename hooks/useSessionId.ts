"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "ai-health-consilium-session";

export function useSessionId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe() {
  return () => undefined;
}

function getServerSnapshot() {
  return null;
}

function getSnapshot() {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const next =
    typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(STORAGE_KEY, next);
  return next;
}
