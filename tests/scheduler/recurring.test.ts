import { describe, it, expect } from "vitest";
import {
  expandRecurrence,
  parseRRule,
  formatRRule,
  describeRRule,
} from "@/lib/scheduler/recurring";

const DTSTART = "2026-01-05T09:00:00.000Z"; // Monday
const RANGE = { from: "2026-01-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" };

describe("parseRRule", () => {
  it("returns null for empty input", () => {
    expect(parseRRule("")).toBeNull();
    expect(parseRRule("   ")).toBeNull();
  });

  it("accepts the RRULE: prefix", () => {
    expect(parseRRule("RRULE:FREQ=DAILY")?.freq).toBe("DAILY");
    expect(parseRRule("FREQ=DAILY")?.freq).toBe("DAILY");
  });

  it("parses INTERVAL", () => {
    expect(parseRRule("FREQ=DAILY;INTERVAL=3")?.interval).toBe(3);
    expect(parseRRule("FREQ=DAILY;INTERVAL=0")?.interval).toBe(1);
  });

  it("parses BYDAY into Weekday enums", () => {
    expect(parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")?.byDay).toEqual(["MO", "WE", "FR"]);
  });

  it("parses BYMONTHDAY", () => {
    expect(parseRRule("FREQ=MONTHLY;BYMONTHDAY=1,15")?.byMonthDay).toEqual([1, 15]);
  });

  it("parses COUNT and UNTIL", () => {
    expect(parseRRule("FREQ=DAILY;COUNT=5")?.count).toBe(5);
    const u = parseRRule("FREQ=DAILY;UNTIL=20260201T000000Z");
    expect(u?.until).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rejects unknown FREQ", () => {
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
  });
});

describe("formatRRule + describeRRule", () => {
  it("round-trips a daily rule", () => {
    const r = parseRRule("FREQ=DAILY;INTERVAL=2");
    expect(r).not.toBeNull();
    expect(formatRRule(r!)).toBe("FREQ=DAILY;INTERVAL=2");
  });

  it("produces a human-readable description", () => {
    expect(describeRRule("FREQ=DAILY")).toMatch(/day/i);
    expect(describeRRule("FREQ=WEEKLY;BYDAY=MO,FR")).toMatch(/week.*MO.*FR/i);
    expect(describeRRule("")).toBe("Once");
  });
});

describe("expandRecurrence", () => {
  it("expands DAILY", () => {
    const out = expandRecurrence({ dtstart: DTSTART, rule: "FREQ=DAILY", from: RANGE.from, to: "2026-01-09T23:59:59.000Z" });
    expect(out.length).toBe(5);
    expect(out[0]).toBe("2026-01-05T09:00:00.000Z");
  });

  it("respects INTERVAL", () => {
    const out = expandRecurrence({ dtstart: DTSTART, rule: "FREQ=DAILY;INTERVAL=2", from: RANGE.from, to: "2026-01-15T23:59:59.000Z" });
    expect(out.length).toBe(6); // every other day, Jan 5–15
  });

  it("respects COUNT", () => {
    const out = expandRecurrence({ dtstart: DTSTART, rule: "FREQ=DAILY;COUNT=3", from: RANGE.from, to: RANGE.to });
    expect(out.length).toBe(3);
  });

  it("respects UNTIL", () => {
    const out = expandRecurrence({ dtstart: DTSTART, rule: "FREQ=DAILY;UNTIL=20260108T235959Z", from: RANGE.from, to: RANGE.to });
    expect(out.length).toBe(4); // Jan 5,6,7,8
  });

  it("expands WEEKLY with BYDAY", () => {
    const out = expandRecurrence({
      dtstart: DTSTART, // Monday
      rule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      from: RANGE.from,
      to: "2026-01-31T23:59:59.000Z",
    });
    // Jan 5 (MO) → Jan 30 (FR): MO/WE/FR each week, 4 weeks complete + tail
    expect(out.length).toBeGreaterThanOrEqual(11);
    for (const iso of out) {
      const dow = new Date(iso).getUTCDay();
      expect([1, 3, 5]).toContain(dow);
    }
  });

  it("expands MONTHLY on BYMONTHDAY", () => {
    const out = expandRecurrence({
      dtstart: "2026-01-15T10:00:00.000Z",
      rule: "FREQ=MONTHLY;BYMONTHDAY=15",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.000Z",
    });
    expect(out.length).toBe(6);
  });

  it("expands YEARLY", () => {
    const out = expandRecurrence({
      dtstart: "2024-12-31T12:00:00.000Z",
      rule: "FREQ=YEARLY",
      from: "2024-01-01T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
    expect(out.length).toBe(3); // 2024, 2025, 2026
  });

  it("applies EXDATE exclusions", () => {
    const out = expandRecurrence({
      dtstart: DTSTART,
      rule: "FREQ=DAILY;COUNT=5",
      from: RANGE.from,
      to: RANGE.to,
      exclude: ["2026-01-06T09:00:00.000Z"],
    });
    expect(out.length).toBe(4);
    expect(out).not.toContain("2026-01-06T09:00:00.000Z");
  });

  it("returns [dtstart] when the rule is unparseable", () => {
    const out = expandRecurrence({ dtstart: DTSTART, rule: "FREQ=BOGUS", from: RANGE.from, to: RANGE.to });
    expect(out).toEqual([DTSTART]);
  });

  it("caps emitted occurrences", () => {
    const out = expandRecurrence({
      dtstart: DTSTART,
      rule: "FREQ=DAILY",
      from: RANGE.from,
      to: "2030-01-01T00:00:00.000Z",
      maxOccurrences: 12,
    });
    expect(out.length).toBe(12);
  });

  it("never returns occurrences before from", () => {
    const out = expandRecurrence({
      dtstart: DTSTART,
      rule: "FREQ=DAILY",
      from: "2026-01-08T00:00:00.000Z",
      to: "2026-01-10T23:59:59.000Z",
    });
    for (const iso of out) {
      expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(new Date("2026-01-08T00:00:00.000Z").getTime());
    }
  });
});
