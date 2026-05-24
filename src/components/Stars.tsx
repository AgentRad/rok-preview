export default function Stars({
  value,
  size = 14,
}: {
  value: number;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  const full = Math.round(clamped);
  return (
    <span
      aria-label={`${clamped.toFixed(1)} out of 5`}
      style={{
        display: "inline-flex",
        gap: 1,
        fontSize: size,
        lineHeight: 1,
        color: "var(--amber-deep)",
      }}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ opacity: i <= full ? 1 : 0.25 }}>
          ★
        </span>
      ))}
    </span>
  );
}
