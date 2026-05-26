"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const CookieConsent = dynamic(() => import("./CookieConsent"), { ssr: false });
const DemoGuide = dynamic(() => import("./DemoGuide"), { ssr: false });

/**
 * Defers loading of below-fold chrome (cookie banner, demo guide overlay)
 * until either 1500 ms after first paint or the first user interaction
 * (scroll, pointer, key). Both targets are `position: fixed` overlays, so
 * mounting them later has zero CLS impact: nothing in the document flow
 * shifts when they appear.
 */
export default function DeferredChrome({
  showDemoGuide,
}: {
  showDemoGuide: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let canceled = false;
    const trigger = () => {
      if (canceled) return;
      setReady(true);
    };
    const timer = window.setTimeout(trigger, 1500);
    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener("scroll", trigger, opts);
    window.addEventListener("pointerdown", trigger, opts);
    window.addEventListener("keydown", trigger, opts);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
      window.removeEventListener("scroll", trigger);
      window.removeEventListener("pointerdown", trigger);
      window.removeEventListener("keydown", trigger);
    };
  }, []);

  if (!ready) return null;

  return (
    <>
      <CookieConsent />
      {showDemoGuide && <DemoGuide />}
    </>
  );
}
