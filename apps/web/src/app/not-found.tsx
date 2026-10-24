import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6">
      <div className="glass max-w-md rounded-[var(--radius)] p-8 text-center">
        <p className="font-mono text-[12px] text-faint">404</p>
        <h1 className="mt-2 text-[22px] font-bold">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-[13.5px] text-muted">If you followed a job link, the job may have expired and been deleted.</p>
        <Link href="/" className={buttonClass("primary", "md", "mt-5")}>Back to JustDownload</Link>
      </div>
    </main>
  );
}
