"use client";
import { buttonClass } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6">
      <div role="alert" className="glass max-w-md rounded-[var(--radius)] p-8 text-center">
        <h1 className="text-[20px] font-bold">Something went wrong</h1>
        <p className="mt-2 text-[13.5px] text-muted">The page failed to load. No details are shown here for security; try again.</p>
        <button type="button" onClick={reset} className={buttonClass("primary", "md", "mt-5")}>Try again</button>
      </div>
    </main>
  );
}
