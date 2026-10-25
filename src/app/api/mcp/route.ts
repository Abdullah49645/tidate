import { publicStatus } from "@/lib/config";
import { createDemoProvider } from "@/lib/demo/provider";
import { createTidateMcpHandler } from "@/lib/mcp/server";
import { createLiveProvider } from "@/lib/providers";

export const maxDuration = 60;

const handler = createTidateMcpHandler((mode) => {
  const live = publicStatus().liveAvailable;
  if (mode === "demo" || !live) {
    return {
      provider: createDemoProvider(),
      note: mode === "live" && !live ? "[DEMO DATA – live mode is not configured on this server; results are fictional]" : "[DEMO DATA – fictional artists and venues]",
    };
  }
  return { provider: createLiveProvider(), note: "[LIVE – Ticketmaster events + Qloo affinity]" };
});

export { handler as GET, handler as POST, handler as DELETE };
