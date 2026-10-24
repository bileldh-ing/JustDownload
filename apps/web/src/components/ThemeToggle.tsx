"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "jd-theme";

function readPref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" || v === "system" ? v : "dark"; } catch { return "dark"; }
}
function resolve(p: ThemePref): "light" | "dark" {
  if (p !== "system") return p;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function apply(p: ThemePref) {
  try { localStorage.setItem(KEY, p); } catch { /* storage unavailable */ }
  const root = document.documentElement;
  root.classList.add("jd-theme-switching");
  root.dataset.theme = resolve(p);
  root.dataset.themePref = p;
  window.setTimeout(() => root.classList.remove("jd-theme-switching"), 300);
}

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const NAME = { light: "Light", dark: "Dark", system: "System" } as const;

/** Light / dark / system theme menu (same pattern as PinFlow). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>("dark");
  useEffect(() => { setPref(readPref()); }, []);
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const f = () => { document.documentElement.dataset.theme = mq.matches ? "light" : "dark"; };
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [pref]);
  const Current = ICON[pref];
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger aria-label={`Theme: ${NAME[pref]}. Change theme`} title="Theme" data-testid="theme-toggle"
        className={`jd-transition jd-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted outline-none hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)] data-[state=open]:bg-surface-hover data-[state=open]:text-fg ${className}`}>
        <Current size={16} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="glass-solid jd-menu z-[60] min-w-[168px] rounded-2xl p-1.5 text-[13.5px] text-fg">
          <Menu.Label className="px-2.5 pb-1 pt-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-faint">Theme</Menu.Label>
          <Menu.RadioGroup value={pref} onValueChange={(v) => { const p = v as ThemePref; apply(p); setPref(p); }}>
            {(["light", "dark", "system"] as const).map((p) => {
              const Icon = ICON[p];
              return (
                <Menu.RadioItem key={p} value={p} data-testid={`theme-option-${p}`} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none data-[highlighted]:bg-surface-hover">
                  <Icon size={15} className="shrink-0 text-muted" aria-hidden />
                  <span className="flex-1">{NAME[p]}</span>
                  <Menu.ItemIndicator><Check size={14} className="text-accent" aria-hidden /></Menu.ItemIndicator>
                </Menu.RadioItem>
              );
            })}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
