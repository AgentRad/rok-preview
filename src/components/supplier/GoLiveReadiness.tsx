import GoLiveGauge from "@/components/GoLiveGauge";
import type { computeReadiness } from "@/lib/supplier-access";

type Readiness = ReturnType<typeof computeReadiness>;

// PLH-3l P2: extracted from /supplier/page.tsx GoLiveGauge usage.
// PLH-3l P5: when hideWhenComplete is true and the readiness is fully done,
// the component renders nothing.
export default function GoLiveReadiness({
  readiness,
  publicVisible,
  hideWhenComplete = false,
}: {
  readiness: Readiness;
  publicVisible: boolean;
  hideWhenComplete?: boolean;
}) {
  if (hideWhenComplete && readiness.ready && publicVisible) {
    return null;
  }
  return (
    <GoLiveGauge readiness={readiness} publicVisible={publicVisible} />
  );
}
