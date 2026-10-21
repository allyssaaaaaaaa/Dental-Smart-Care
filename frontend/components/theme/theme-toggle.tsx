"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Turn dark mode off" : "Turn dark mode on"}
      aria-pressed={dark}
      title={dark ? "Turn dark mode off" : "Turn dark mode on"}
      className={`inline-flex items-center gap-2 rounded-btn border border-border px-3 py-2 text-[12px] font-semibold shadow-card transition-colors duration-200 ${
        dark
          ? "bg-tint-2 text-primary hover:bg-tint-3"
          : "bg-white text-heading hover:bg-page"
      } ${className}`}
    >
      {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
