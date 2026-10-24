import { AppShell } from "@/components/AppShell";
import { Downloader } from "@/components/Downloader";
import { HomeBelowFold } from "@/components/HomeBelowFold";
import { Overview } from "@/components/Overview";
import { appStatus } from "@/server/status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await appStatus();
  return (
    <AppShell status={status} aside={<Overview status={status} />}>
      <Downloader status={status} />
      <HomeBelowFold status={status} />
    </AppShell>
  );
}
