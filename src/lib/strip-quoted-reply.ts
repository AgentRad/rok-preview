/**
 * Strip quoted-history, signatures, and common email cruft from a reply body.
 * Goal: keep just what the user actually typed at the top of the message.
 * This is best-effort, not perfect; we lean on conservative heuristics so we
 * never lose actual content even if we leave some quoted lines behind.
 *
 * Pure string function. Lives in its own file (no `server-only` import) so
 * the standalone test harness in scripts/ can exercise it via Node's
 * built-in test runner without bundler shims.
 */
export function stripQuotedReply(raw: string): string {
  if (!raw) return "";
  // Normalize line endings.
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");

  // Find the first "On ... wrote:" header (Gmail / Apple Mail / Outlook).
  // Gmail iOS soft-wraps the FROM address onto the next line, so "wrote:"
  // can land on line N+1 (or N+2) after "On ...". Join up to 3 lines and
  // test the combined string.
  let onWroteIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*On\b/.test(lines[i])) continue;
    for (let span = 1; span <= 3 && i + span - 1 < lines.length; span++) {
      const joined = lines
        .slice(i, i + span)
        .join(" ")
        .trim();
      if (/^On\b.{0,400}\bwrote:\s*$/i.test(joined)) {
        onWroteIdx = i;
        break;
      }
    }
    if (onWroteIdx !== -1) break;
  }
  // Find the first "From: ..." block (Outlook).
  const fromHeaderIdx = lines.findIndex(
    (l) => /^\s*From:\s.+<.+@.+>\s*$/i.test(l) || /^_{3,}$/.test(l)
  );
  // Find the first "-- " signature delimiter (RFC 3676), or bare "--" / "__".
  const sigIdx = lines.findIndex((l) => /^(-- ?|--|__)$/.test(l));
  // Markdown-italic name line (Gmail composer often wraps the signed name
  // in `*Name*`) followed by a short sig-like block. Conservative: only
  // strip when the following block is <=4 non-empty lines, each short and
  // without question marks.
  let italicSigIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^\*[^*\n]{2,60}\*$/.test(t)) continue;
    const sigLines: string[] = [];
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const l = lines[j].trim();
      if (l === "") break;
      sigLines.push(l);
    }
    if (sigLines.length === 0) continue;
    if (sigLines.length > 4) continue;
    const looksLikeSig = sigLines.every(
      (l) => l.length <= 80 && !/[?]/.test(l)
    );
    if (looksLikeSig) {
      italicSigIdx = i;
      break;
    }
  }
  // Find the first line that is purely a ">" quoted block (Gmail-style).
  let quoteRunIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i])) {
      // Require two consecutive quoted lines so we don't eat a single ">"
      // glyph used in plain text.
      if (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) {
        quoteRunIdx = i;
        break;
      }
    }
  }

  const candidates = [
    onWroteIdx,
    fromHeaderIdx,
    sigIdx,
    italicSigIdx,
    quoteRunIdx,
  ].filter((i) => i > 0);
  const cutAt = candidates.length > 0 ? Math.min(...candidates) : lines.length;

  let body = lines.slice(0, cutAt).join("\n");
  // Trim "Sent from my iPhone" style sign-offs even when the "-- " delimiter
  // is missing.
  body = body.replace(
    /\n+(Sent from my [^\n]+|Get Outlook for [^\n]+|Sent via [^\n]+|Get the [^\n]+)\s*$/i,
    ""
  );
  return body.trim();
}
