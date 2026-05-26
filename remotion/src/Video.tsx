import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS, Scene, VideoSpec } from "./scenes";

const COLORS = {
  bg: "#f3f2ef",
  ink: "#1a1916",
  steel: "#6e6c60",
  line: "#e2dfd6",
  amber: "#e0a32a",
  amberDeep: "#835d0e",
  paper: "#f3f2ef",
  dark: "#0d0c0a",
};

const FONT_SANS = '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

function BrandCorner({ subtitle, isDark }: { subtitle: string; isDark: boolean }) {
  const color = isDark ? "rgba(243,242,239,0.5)" : COLORS.steel;
  const strong = isDark ? "#f3f2ef" : COLORS.ink;
  return (
    <div
      style={{
        position: "absolute",
        top: 36,
        left: 48,
        fontFamily: FONT_MONO,
        fontSize: 14,
        letterSpacing: 2,
        textTransform: "uppercase",
        color,
        zIndex: 10,
      }}
    >
      <span style={{ color: strong, fontFamily: FONT_SANS, fontSize: 20, fontWeight: 600, letterSpacing: -0.2, textTransform: "none", marginRight: 10 }}>
        PartsPort
      </span>
      · {subtitle}
    </div>
  );
}

function WordReveal({ text, startFrame, color }: { text: string; startFrame: number; color: string }) {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/);
  return (
    <span>
      {words.map((w, i) => {
        const delay = startFrame + i * 2;
        const localFrame = frame - delay;
        const opacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const translateY = interpolate(localFrame, [0, 12], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${translateY}px)`,
              color,
              marginRight: i < words.length - 1 ? "0.32em" : 0,
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
}

function HookScene({ scene, frames }: { scene: Extract<Scene, { kind: "hook" }>; frames: number }) {
  const frame = useCurrentFrame();
  const containerOpacity = interpolate(frame, [0, 12, frames - 10, frames], [0, 1, 1, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: COLORS.dark, opacity: containerOpacity }}>
      <BrandCorner subtitle="" isDark />
      <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 100 }}>
        <h1
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 500,
            fontSize: 84,
            lineHeight: 1.05,
            letterSpacing: -1.6,
            textAlign: "center",
            color: "#f3f2ef",
            maxWidth: 900,
            margin: 0,
          }}
        >
          <WordReveal text={scene.headline} startFrame={6} color="#f3f2ef" />
        </h1>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function DemoScene({ scene, frames, brandSubtitle }: { scene: Extract<Scene, { kind: "demo" }>; frames: number; brandSubtitle: string }) {
  const frame = useCurrentFrame();
  const containerOpacity = interpolate(frame, [0, 14, frames - 8, frames], [0, 1, 1, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shotScale = interpolate(frame, [0, frames], [0.965, 1.02]);
  const shotOpacity = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const eyebrowOpacity = interpolate(frame, [6, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const eyebrowY = interpolate(frame, [6, 20], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, opacity: containerOpacity }}>
      <BrandCorner subtitle={brandSubtitle} isDark={false} />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "120px 80px 80px" }}>
        <div
          style={{
            width: "82%",
            height: "55%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 48,
          }}
        >
          <Img
            src={staticFile(scene.image)}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 10,
              boxShadow: "0 1px 0 rgba(0,0,0,0.03), 0 36px 80px -32px rgba(26,25,22,0.30)",
              transform: `scale(${shotScale})`,
              opacity: shotOpacity,
            }}
          />
        </div>
        <div style={{ width: "82%", textAlign: "left" }}>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 17,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: COLORS.amberDeep,
              marginBottom: 18,
              opacity: eyebrowOpacity,
              transform: `translateY(${eyebrowY}px)`,
            }}
          >
            {scene.eyebrow}
          </div>
          <h2
            style={{
              fontFamily: FONT_SANS,
              fontWeight: 500,
              fontSize: 52,
              lineHeight: 1.06,
              letterSpacing: -1.0,
              color: COLORS.ink,
              margin: 0,
              maxWidth: "90%",
            }}
          >
            <WordReveal text={scene.headline} startFrame={14} color={COLORS.ink} />
          </h2>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function CTAScene({ scene, frames }: { scene: Extract<Scene, { kind: "cta" }>; frames: number }) {
  const frame = useCurrentFrame();
  const containerOpacity = interpolate(frame, [0, 14, frames - 10, frames], [0, 1, 1, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const eyebrowOpacity = interpolate(frame, [6, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const urlOpacity = interpolate(frame, [38, 56], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const urlY = interpolate(frame, [38, 56], [12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: COLORS.dark, opacity: containerOpacity }}>
      <BrandCorner subtitle="" isDark />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 100 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 17,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: COLORS.amber,
            marginBottom: 22,
            opacity: eyebrowOpacity,
          }}
        >
          {scene.eyebrow}
        </div>
        <h2
          style={{
            fontFamily: FONT_SANS,
            fontWeight: 500,
            fontSize: 72,
            lineHeight: 1.05,
            letterSpacing: -1.5,
            textAlign: "center",
            color: "#f3f2ef",
            maxWidth: 900,
            margin: 0,
          }}
        >
          <WordReveal text={scene.headline} startFrame={12} color="#f3f2ef" />
        </h2>
        <div
          style={{
            marginTop: 44,
            display: "inline-block",
            fontFamily: FONT_MONO,
            fontSize: 16,
            letterSpacing: 2,
            padding: "14px 24px",
            border: "1px solid rgba(243,242,239,0.32)",
            color: "#f3f2ef",
            opacity: urlOpacity,
            transform: `translateY(${urlY}px)`,
          }}
        >
          {scene.url}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function PartsPortVideo({ spec }: { spec: VideoSpec }) {
  let acc = 0;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {spec.scenes.map((scene, idx) => {
        const frames = Math.round(scene.durationSec * FPS);
        const from = acc;
        acc += frames;
        return (
          <Sequence key={idx} from={from} durationInFrames={frames} layout="none">
            {scene.kind === "hook" && <HookScene scene={scene} frames={frames} />}
            {scene.kind === "demo" && <DemoScene scene={scene} frames={frames} brandSubtitle={spec.brandSubtitle} />}
            {scene.kind === "cta" && <CTAScene scene={scene} frames={frames} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
