"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

const THEME_KEY = "ai-health-consilium-theme";
const THEME_EVENT = "ai-health-consilium-theme-change";

export type ThemeMode = "light" | "dark";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeMode();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return children;
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);
}

export function setThemeMode(theme: ThemeMode) {
  window.localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_EVENT, onStoreChange);
  };
}

function getServerSnapshot(): ThemeMode {
  return "light";
}

function getThemeSnapshot(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
