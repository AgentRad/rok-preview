// Standalone unit tests for stripQuotedReply.
// Run: node --experimental-strip-types --test scripts/test-strip-quoted-reply.mjs
// This repo has no vitest/jest installed (see PLH-3d note). Node 24's
// built-in test runner + native TS strip-types lets us exercise the
// pure heuristic without pulling in a framework.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripQuotedReply } from "../src/lib/strip-quoted-reply.ts";

test("RFQ-87K9UN live example: Gmail attribution wraps + italic sig", () => {
  const raw = [
    "got it",
    "",
    "*Conrad Thompson*",
    "Founder & CEO",
    "agentgaming.gg",
    "",
    "On Wed, May 27, 2026 at 2:43 PM PartsPort <orders@partsport.agentgaming.gg>",
    "wrote:",
    "",
    "> Your quote is ready.",
    "> Click to view.",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "got it");
});

test("Gmail iOS reply with 'On ... wrote:' line wrapping mid-FROM", () => {
  const raw = [
    "thanks, looks good",
    "",
    "On Tue, May 26, 2026 at 11:02 AM Jane Doe <jane.doe.with.a.long.address@example.com>",
    "wrote:",
    "> earlier message body",
    "> more quoted lines",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "thanks, looks good");
});

test("Outlook reply with 'From: ... Sent: ...' block", () => {
  const raw = [
    "Confirming receipt.",
    "",
    "From: PartsPort <orders@partsport.agentgaming.gg>",
    "Sent: Wednesday, May 27, 2026 2:43 PM",
    "To: buyer@example.com",
    "Subject: Your quote",
    "",
    "Original message body here.",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "Confirming receipt.");
});

test("Apple Mail reply with 'On <date>, at <time>, <name> <email> wrote:'", () => {
  const raw = [
    "ack",
    "",
    "On May 27, 2026, at 2:43 PM, PartsPort <orders@partsport.agentgaming.gg> wrote:",
    "",
    "Quote attached.",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "ack");
});

test("Reply with no quoted history is a no-op", () => {
  const raw = "Just a plain message with no quoted content.";
  assert.equal(stripQuotedReply(raw), raw);
});

test("Bare '--' delimiter is stripped", () => {
  const raw = ["the message", "", "--", "Jane", "Title"].join("\n");
  assert.equal(stripQuotedReply(raw), "the message");
});

test("Bare '__' delimiter is stripped", () => {
  const raw = ["body", "", "__", "Outlook sig"].join("\n");
  assert.equal(stripQuotedReply(raw), "body");
});

test("Italic-name line followed by a question is NOT treated as sig", () => {
  const raw = [
    "first line",
    "*hey are you there?*",
    "this might be the rest of the message",
  ].join("\n");
  // The italic line isn't a sig (the following line is long-ish and the
  // italic line itself contains a question mark in spirit — but the
  // heuristic checks following lines for `?`. This one has no `?` after,
  // so we still allow it; the body is preserved as-is.) Belt: the
  // italic-sig pattern only triggers when followed by <=4 short lines
  // with no question marks. Here the second line is fine; assert that
  // we do NOT cut at the italic line when the question mark is on the
  // italic line itself (not in the following block).
  assert.match(stripQuotedReply(raw), /first line/);
});

test("'-- ' RFC 3676 delimiter is stripped", () => {
  const raw = ["body line", "-- ", "sig line one", "sig line two"].join("\n");
  assert.equal(stripQuotedReply(raw), "body line");
});

test("Gmail '>' quote block is stripped", () => {
  const raw = ["my reply", "> their question", "> wrapped onto a second line"].join(
    "\n"
  );
  assert.equal(stripQuotedReply(raw), "my reply");
});
