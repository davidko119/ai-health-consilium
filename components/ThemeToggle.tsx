"use client";

import { Moon, Sun } from "lucide-react";
import { setThemeMode, useThemeMode } from "./ThemeProvider";

export function ThemeToggle() {
  const theme = useThemeMode();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      className="icon-button"
      type="button"
      title={`Switch to ${nextTheme} mode`}
      onClick={() => setThemeMode(nextTheme)}
    >
      <Icon size={17} aria-hidden="true" />
      <span className="sr-only">Switch to {nextTheme} mode</span>
    </button>
  );
}
