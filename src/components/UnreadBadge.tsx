// PLH-3p F4: small unread-message count badge used in top-nav and on
// thread-list rows. Renders nothing when count <= 0 so callers can drop
// it in unconditionally.

type Props = {
  count: number;
  /** "pill" renders the number in a small red pill (top nav). "dot"
   *  renders just a small red dot (thread-list rows). */
  variant?: "pill" | "dot";
  ariaLabel?: string;
  style?: React.CSSProperties;
};

export default function UnreadBadge({
  count,
  variant = "pill",
  ariaLabel,
  style,
}: Props) {
  if (!count || count <= 0) return null;
  if (variant === "dot") {
    return (
      <span
        aria-label={ariaLabel || `${count} unread`}
        role="status"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#dc2626",
          marginLeft: 6,
          verticalAlign: "middle",
          ...style,
        }}
      />
    );
  }
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-label={ariaLabel || `${count} unread`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 6px",
        borderRadius: 9,
        background: "#dc2626",
        color: "white",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        marginLeft: 6,
        ...style,
      }}
    >
      {label}
    </span>
  );
}
