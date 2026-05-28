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
    // PLH-3u P1: confirm the milestone instead of rendering nothing.
    return (
      <div className="alert alert-ok" style={{ marginTop: 16 }}>
        You are live, accepting orders.
      </div>
    );
  }
  return (
    <GoLiveGauge readiness={readiness} publicVisible={publicVisible} />
  );
}
