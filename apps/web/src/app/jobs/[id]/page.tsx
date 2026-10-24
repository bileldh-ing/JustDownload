import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { JobPanel } from "@/components/JobPanel";
import { Overview } from "@/components/Overview";
import { appStatus } from "@/server/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Processing", robots: { index: false } };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = await appStatus();
  return (
    <AppShell status={status} aside={<Overview status={status} />}>
      <JobPanel id={id} />
    </AppShell>
  );
}
