import { describe, expect, it } from "vitest";
import { strings } from "../src/plugin/i18n";
import { BUILTIN, localDay, OUTCOMES, Stats, tagOf, verdict, type Counts } from "../src/plugin/stats";
import { renderStats } from "../src/plugin/stats-export";

const exact = tagOf({ layer: 0, reasons: [{ code: "exact" }], flags: [] });
const prefixed = tagOf({ layer: 1, reasons: [{ code: "prefix", detail: "وبال" }, { code: "definite" }], flags: [] });
const indefinite = tagOf({ layer: 1, reasons: [{ code: "indefinite" }], flags: ["quote"] });
const possible = tagOf({ layer: 2, reasons: [{ code: "suffix", detail: "ها" }], flags: ["unvocalized"] });

const full = (c: Counts): Required<Counts> => ({ linked: 0, undone: 0, rejected: 0, formIgnored: 0, restored: 0, cancelled: 0, ...c });

describe("tagOf", () => {
  it("splits the optional indefinite form out of layer 1", () => {
    expect(exact.layer).toBe("0");
    expect(prefixed.layer).toBe("1");
    expect(indefinite.layer).toBe("1i");
    expect(possible.layer).toBe("2");
  });

  it("keeps each reason once and carries the flags", () => {
    const t = tagOf({ layer: 1, reasons: [{ code: "prefix", detail: "ب" }, { code: "prefix", detail: "ال" }], flags: ["table", "quote"] });
    expect(t.reasons).toEqual(["prefix"]);
    expect(t.flags).toEqual(["table", "quote"]);
  });
});

describe("built-in equivalence", () => {
  it("marks layer 0 matches the built-in search would find too", () => {
    expect(exact.reasons).toEqual(["exact", BUILTIN]);
    expect(tagOf({ layer: 0, reasons: [{ code: "alias", detail: "writing" }, { code: "case" }], flags: [] }).reasons).toContain(BUILTIN);
  });

  it("does not mark anything the built-in search misses", () => {
    expect(tagOf({ layer: 0, reasons: [{ code: "exact" }, { code: "diacritics" }], flags: [] }).reasons).not.toContain(BUILTIN);
    expect(tagOf({ layer: 0, reasons: [{ code: "tatweel" }], flags: [] }).reasons).not.toContain(BUILTIN);
    expect(prefixed.reasons).not.toContain(BUILTIN);
    expect(tagOf({ layer: 2, reasons: [{ code: "exact" }], flags: ["unvocalized"] }).reasons).not.toContain(BUILTIN);
    expect(tagOf({ layer: 0, reasons: [], flags: [] }).reasons).toEqual([]);
  });
});

describe("localDay", () => {
  it("writes Latin digits in the local calendar", () => {
    expect(localDay(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

describe("Stats.record", () => {
  it("counts each event under its layer, every reason and every flag, per day", () => {
    const s = new Stats();
    s.record("2026-10-10", "linked", prefixed);
    s.record("2026-10-10", "linked", prefixed);
    s.record("2026-10-11", "rejected", indefinite);
    expect(s.totals("layer").get("1")).toEqual(full({ linked: 2 }));
    expect(s.totals("layer").get("1i")).toEqual(full({ rejected: 1 }));
    expect(s.totals("reason").get("prefix")?.linked).toBe(2);
    expect(s.totals("reason").get("definite")?.linked).toBe(2);
    expect(s.totals("flag").get("quote")?.rejected).toBe(1);
    expect(s.dayList).toEqual(["2026-10-10", "2026-10-11"]);
    expect(s.totals("layer", { from: "2026-10-11" }).has("1")).toBe(false);
    expect(s.layerOn("2026-10-10", "1").linked).toBe(2);
  });

  it("ignores a malformed day", () => {
    const s = new Stats();
    s.record("اليوم", "linked", exact);
    expect(s.empty).toBe(true);
  });

  it("keeps no note name or text, only numbers and codes", () => {
    const s = new Stats();
    s.record("2026-10-10", "linked", possible);
    expect(JSON.stringify(s.toJSON())).toBe('{"v":1,"days":{"2026-10-10":{"layer":{"2":{"linked":1}},"reason":{"suffix":{"linked":1}},"flag":{"unvocalized":{"linked":1}}}}}');
  });
});

describe("Stats.read", () => {
  it("returns an empty set for missing or broken data", () => {
    expect(Stats.read(null).empty).toBe(true);
    expect(Stats.read("x").empty).toBe(true);
    expect(Stats.read({ days: 3 }).empty).toBe(true);
  });

  it("round-trips what it writes", () => {
    const s = new Stats();
    s.record("2026-10-10", "linked", prefixed);
    s.record("2026-10-10", "undone", prefixed);
    expect(Stats.read(JSON.parse(JSON.stringify(s.toJSON()))).toJSON()).toEqual(s.toJSON());
  });

  it("drops only the broken entries", () => {
    const s = Stats.read({
      days: {
        "2026-10-10": { layer: { "0": { linked: 3, rejected: -1, bogus: 5, restored: 1.5 }, "../x": { linked: 9 } }, reason: { exact: { linked: "3" } }, flag: [] },
        "yesterday": { layer: { "0": { linked: 1 } } },
      },
    });
    expect(s.dayList).toEqual(["2026-10-10"]);
    expect(s.totals("layer").get("0")).toEqual(full({ linked: 3 }));
    expect(s.totals("layer").has("../x")).toBe(false);
    expect(s.totals("reason").size).toBe(0);
  });
});

describe("Stats.mergeMax", () => {
  it("never lowers a counter and takes what the other copy has more of", () => {
    const mine = new Stats();
    mine.record("2026-10-10", "linked", exact);
    mine.record("2026-10-10", "linked", exact);
    const disk = Stats.read(mine.toJSON());
    disk.record("2026-10-10", "linked", exact);
    disk.record("2026-10-11", "rejected", exact);
    mine.mergeMax(disk);
    expect(mine.layerOn("2026-10-10", "0").linked).toBe(3);
    expect(mine.layerOn("2026-10-11", "0").rejected).toBe(1);
    mine.mergeMax(Stats.read(null));
    expect(mine.layerOn("2026-10-10", "0").linked).toBe(3);
  });

  it("is idempotent", () => {
    const a = new Stats();
    a.record("2026-10-10", "linked", exact);
    const b = Stats.read(a.toJSON());
    a.mergeMax(b);
    a.mergeMax(b);
    expect(a.layerOn("2026-10-10", "0").linked).toBe(1);
  });
});

describe("verdict", () => {
  it("is null when nothing was judged", () => {
    expect(verdict(full({ cancelled: 4 }))).toEqual({ judged: 0, accepted: 0, precision: null });
  });

  it("counts an undone link as wrong and a form ignore once", () => {
    // 10 رُبط، 2 تُراجع عنهما، 3 مرفوضة، صيغة واحدة: المقبول 8 من 14
    const v = verdict(full({ linked: 10, undone: 2, rejected: 3, formIgnored: 1 }));
    expect(v.accepted).toBe(8);
    expect(v.judged).toBe(14);
    expect(v.precision).toBeCloseTo(8 / 14);
  });

  it("takes restored rejections back, never below zero", () => {
    expect(verdict(full({ linked: 4, rejected: 2, restored: 1 })).judged).toBe(5);
    expect(verdict(full({ linked: 4, restored: 3 })).judged).toBe(4);
  });

  it("never lets undone exceed linked", () => {
    expect(verdict(full({ linked: 1, undone: 3 }))).toEqual({ judged: 1, accepted: 0, precision: 0 });
  });
});

describe("renderStats", () => {
  const sample = (): Stats => {
    const s = new Stats();
    for (let i = 0; i < 19; i++) s.record("2026-10-10", "linked", exact);
    s.record("2026-10-10", "rejected", exact);
    s.record("2026-10-11", "linked", indefinite);
    s.record("2026-10-11", "rejected", possible);
    s.record("2026-10-11", "cancelled", possible);
    return s;
  };

  it("writes Arabic tables with Arabic-Indic digits and the plan's thresholds", () => {
    const md = renderStats(sample(), strings("ar"), { version: "0.1.2", today: "2026-10-11" });
    expect(md.startsWith("---\nwasl: exact\n---\n")).toBe(true);
    expect(md).toContain("# إحصاءات وصل");
    expect(md).toContain("من 2026-10-10 إلى 2026-10-11");
    expect(md).toMatch(/\| ٠ — تطابق \| ١٩ \| ٠ \| ١ \| ٠ \| ٠ \| ٠ \| ٢٠ \| ٩٥٪ \| ٩٥٪ \|/);
    expect(md).toMatch(/\| ١ — بلا «ال» \(النكرة\) \| ١ \|.*\| — \|/);
    expect(md).toMatch(/\| ٢ — محتمل \|.*\| ٧٠٪ \|/);
    expect(md).toContain("ضمير متصل");
    expect(md).toContain("بلا تشكيل (العنوان مشكول)");
    expect(md).toContain("```json");
  });

  it("has an English form", () => {
    const md = renderStats(sample(), strings("en"), { version: "0.1.2", today: "2026-10-11" });
    expect(md).toContain("# Wasl statistics");
    expect(md).toMatch(/\| 0 — exact \| 19 \| 0 \| 1 \| 0 \| 0 \| 0 \| 20 \| 95% \| 95% \|/);
  });

  it("lists one row per day with accepted / rejected", () => {
    const md = renderStats(sample(), strings("en"), { version: "0.1.2", today: "2026-10-11" });
    expect(md).toMatch(/\| 2026-10-10 \| 19 \/ 1 \| — \| — \| — \|/);
    expect(md).toMatch(/\| 2026-10-11 \| — \| — \| 1 \/ 0 \| 0 \/ 1 \|/);
  });

  it("carries the raw numbers so the trial report can read them back", () => {
    const s = sample();
    const md = renderStats(s, strings("ar"), { version: "0.1.2", today: "2026-10-11" });
    const json = /```json\n(.*)\n```/.exec(md)?.[1] ?? "";
    expect(Stats.read(JSON.parse(json)).toJSON()).toEqual(s.toJSON());
  });

  it("computes the gain over the built-in feature from kept links in layers 0 and 1", () => {
    const s = new Stats();
    const diacritic = tagOf({ layer: 0, reasons: [{ code: "exact" }, { code: "diacritics" }], flags: [] });
    for (let i = 0; i < 3; i++) s.record("2026-10-10", "linked", exact);
    for (let i = 0; i < 2; i++) s.record("2026-10-10", "linked", diacritic);
    for (let i = 0; i < 3; i++) s.record("2026-10-10", "linked", prefixed);
    s.record("2026-10-10", "linked", indefinite); // خارج الطبقتين ٠ و١ في هذا القياس
    s.record("2026-10-10", "undone", diacritic); // الرابط المتراجَع عنه لا يبقى
    const md = renderStats(s, strings("en"), { version: "0.1.2", today: "2026-10-10" });
    expect(md).toContain("Links kept in layers 0 and 1: 7. Also found by the built-in feature: 3. Gain: 57.1% (threshold: one third).");
    expect(renderStats(s, strings("ar"), { version: "0.1.2", today: "2026-10-10" })).toContain("الروابط الباقية في الطبقتين ٠ و١: ٧. منها ما تجده الميزة المدمجة أيضًا: ٣. المكسب: ٥٧٫١٪ (العتبة: الثلث).");
  });

  it("says so when no link was kept yet", () => {
    const s = new Stats();
    s.record("2026-10-10", "rejected", exact);
    expect(renderStats(s, strings("en"), { version: "0.1.2", today: "2026-10-10" })).toContain("No links kept in layers 0 and 1 yet.");
  });

  it("covers every outcome in the table header", () => {
    const md = renderStats(sample(), strings("en"), { version: "0.1.2", today: "2026-10-11" });
    expect(OUTCOMES.length).toBe(6);
    expect(md).toContain("| Layer | Linked | Undone | Rejected | Word ignored | Restored | Preview cancelled | Judged | Precision | Threshold |");
  });
});
