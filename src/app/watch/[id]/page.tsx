import { Suspense } from "react";
import { WatchRoute } from "@/components/WatchPage";

export const metadata = { title: "Tidate watch" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WatchRoute />
    </Suspense>
  );
}
