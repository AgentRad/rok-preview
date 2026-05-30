// Scopes legal.css to /legal/* routes only. Next 15 emits a per-segment
// CSS chunk, so this stylesheet does not ship to homepage visitors.
import "./legal.css";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
