import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const base = "jd-transition jd-press inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100";
const variants: Record<Variant, string> = {
  primary: "jd-accent-fill jd-accent-glow hover:brightness-110 hover:-translate-y-px",
  secondary: "border border-line-strong bg-surface-inner text-fg hover:bg-surface-hover",
  ghost: "text-muted hover:text-fg hover:bg-surface-hover",
  danger: "border border-danger/45 text-danger bg-danger/10 hover:bg-danger/15",
};
const sizes: Record<Size, string> = { sm: "h-8 px-3.5 text-[12.5px]", md: "h-10 px-5 text-sm", lg: "h-12 px-6 text-[15px]", icon: "h-9 w-9 text-sm" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = ""): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({ variant = "secondary", size = "md", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={props.type ?? "button"} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ href, variant = "secondary", size = "md", className = "", children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return <Link href={href} className={buttonClass(variant, size, className)}>{children}</Link>;
}

export function Card({ className = "", children, as: As = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" | "aside"; "aria-labelledby"?: string; "aria-label"?: string }) {
  return <As className={`glass rounded-[var(--radius)] ${className}`} {...rest}>{children}</As>;
}

export type Tone = "neutral" | "accent" | "warn" | "danger" | "ok" | "info";
export function Chip({ tone = "neutral", children, className = "", title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  const tones: Record<Tone, string> = {
    neutral: "border-line text-muted bg-surface-inner",
    accent: "border-accent/40 text-accent bg-accent/12",
    warn: "border-warn/45 text-warn bg-warn/10",
    danger: "border-danger/45 text-danger bg-danger/10",
    ok: "border-ok/40 text-ok bg-ok/10",
    info: "border-info/40 text-info bg-info/10",
  };
  return <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold leading-5 whitespace-nowrap ${tones[tone]} ${className}`}>{children}</span>;
}

export function IconChip({ children, tone = "neutral", size = 40, className = "" }: { children: ReactNode; tone?: "neutral" | "accent" | "mint" | "warn" | "danger"; size?: number; className?: string }) {
  const tones = {
    neutral: "bg-surface-hover text-fg ring-1 ring-line",
    accent: "jd-accent-fill jd-accent-glow",
    mint: "bg-[color-mix(in_srgb,var(--accent-2)_16%,transparent)] text-accent2 ring-1 ring-[color-mix(in_srgb,var(--accent-2)_35%,transparent)]",
    warn: "bg-warn/12 text-warn ring-1 ring-warn/35",
    danger: "bg-danger/12 text-danger ring-1 ring-danger/35",
  } as const;
  return <span aria-hidden style={{ width: size, height: size }} className={`inline-grid shrink-0 place-items-center rounded-full ${tones[tone]} ${className}`}>{children}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-e-transparent ${className}`} />;
}

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return <h2 id={id} className="text-[11px] font-bold uppercase tracking-[0.14em] text-faint">{children}</h2>;
}
