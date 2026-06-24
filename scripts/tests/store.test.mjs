import assert from "node:assert/strict";
import { test } from "node:test";

const {
  formatWebPanelUnreadCount,
  normalizeWebPanelUrl,
  parseWebPanelUnreadCount,
  titleFromUrl,
} = await import("../web-panels-store.uc.mjs");

test("normalizeWebPanelUrl accepts only http and https URLs", () => {
  assert.equal(normalizeWebPanelUrl("example.com"), "https://example.com/");
  assert.equal(normalizeWebPanelUrl("http://example.com/a"), "http://example.com/a");
  assert.equal(normalizeWebPanelUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(normalizeWebPanelUrl("javascript:alert(1)"), null);
  assert.equal(normalizeWebPanelUrl("about:preferences"), null);
  assert.equal(normalizeWebPanelUrl(""), null);
});

test("titleFromUrl derives a readable hostname", () => {
  assert.equal(titleFromUrl("https://www.calendar.google.com/calendar/u/0/r"), "calendar.google.com");
  assert.equal(titleFromUrl("not a url"), "not a url");
});

test("unread helpers parse and format title-prefixed counts", () => {
  assert.equal(parseWebPanelUnreadCount("(3) Inbox"), 3);
  assert.equal(parseWebPanelUnreadCount("[12] Chat"), 12);
  assert.equal(parseWebPanelUnreadCount("Inbox (3)"), null);
  assert.equal(formatWebPanelUnreadCount(0), "");
  assert.equal(formatWebPanelUnreadCount(12), "12");
  assert.equal(formatWebPanelUnreadCount(120), "99+");
});
