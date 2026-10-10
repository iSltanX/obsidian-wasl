import { describe, expect, it } from "vitest";
import type { Flag, Layer, Reason } from "../src/core/match";
import type { Found } from "../src/plugin/context";
import { duplicateNames, present, tagsFor, visibleCount } from "../src/plugin/present";
import { DEFAULT_SETTINGS } from "../src/plugin/settings";

let pos = 0;
function found(layer: Layer, opts: { reasons?: Reason[]; flags?: Flag[]; alias?: string } = {}): Found {
  const start = (pos += 10);
  return {
    path: "الكتابة.md",
    name: opts.alias ?? "الكتابة",
    isAlias: !!opts.alias,
    start,
    end: start + 7,
    surface: "الكتابة",
    layer,
    reasons: opts.reasons ?? [],
    flags: opts.flags ?? [],
    line: 0,
    snippet: { text: "الكتابة", matchStart: 0, matchEnd: 7, cutStart: false, cutEnd: false, dir: "rtl" },
  };
}

const keys = (f: Found) => tagsFor(f).map((t) => (t.detail ? `${t.key}:${t.detail}` : t.key));

describe("tagsFor", () => {
  it("names layer 0 an exact match and keeps writing differences minor", () => {
    expect(keys(found(0, { reasons: [{ code: "diacritics" }] }))).toEqual(["tagExact", "tagDiacritics"]);
    expect(tagsFor(found(0, { reasons: [{ code: "diacritics" }] }))[1]?.minor).toBe(true);
  });

  it("puts layer reasons first, then the alias, then flags", () => {
    const f = found(1, { reasons: [{ code: "prefix", detail: "وبال" }, { code: "lam-lam" }, { code: "tatweel" }], flags: ["quote"], alias: "writing" });
    expect(keys(f)).toEqual(["tagPrefix:وبال", "tagAlias:writing", "tagTatweel", "tagQuote"]);
  });

  it("does not show «diacritics» next to «unvocalized»", () => {
    const f = found(2, { reasons: [{ code: "diacritics" }], flags: ["unvocalized"] });
    expect(keys(f)).toEqual(["tagUnvocalized"]);
  });
});

describe("present", () => {
  const files = [
    { path: "فصل 10.md", items: [found(0), found(2)] },
    { path: "فصل 2.md", items: [found(1, { flags: ["quote"] }), found(0)] },
    { path: "ملاحق/فصل 3.md", items: [found(2), found(2)] },
  ];

  it("splits layers into two sections sorted naturally by path", () => {
    const p = present(files, DEFAULT_SETTINGS);
    expect(p.main.map((g) => g.path)).toEqual(["فصل 2.md", "فصل 10.md"]);
    expect(p.possible.map((g) => g.path)).toEqual(["فصل 10.md", "ملاحق/فصل 3.md"]);
    expect([p.mainCount, p.possibleCount, p.noteCount, p.hidden]).toEqual([3, 3, 3, 0]);
  });

  it("hides quotes and possible mentions when asked, and counts them", () => {
    const p = present(files, { ...DEFAULT_SETTINGS, quotes: "hidden", possible: "hidden" });
    expect([p.mainCount, p.possibleCount, p.hidden]).toEqual([2, 0, 4]);
  });

  it("keeps the first mention per note, preferring sure ones", () => {
    const p = present(files, { ...DEFAULT_SETTINGS, firstMentionOnly: true });
    expect(p.main.map((g) => [g.path, g.items.length])).toEqual([["فصل 2.md", 1], ["فصل 10.md", 1]]);
    expect(p.possible.map((g) => [g.path, g.items.length])).toEqual([["ملاحق/فصل 3.md", 1]]);
    expect(p.hidden).toBe(3);
  });

  it("drops just-linked mentions silently and counts ignored ones", () => {
    const first = files[0]?.items[0] as Found;
    const second = files[0]?.items[1] as Found;
    const p = present(files, DEFAULT_SETTINGS, (_path, m) => (m === first ? "linked" : m === second ? "ignored" : undefined));
    expect([p.mainCount, p.possibleCount, p.hidden, p.ignored]).toEqual([2, 2, 0, 1]);
    expect(p.main.map((g) => g.path)).toEqual(["فصل 2.md"]);
  });

  it("shows nothing from a note that already links the target when first mention only", () => {
    const linked = [{ path: "أ.md", items: [found(0, { flags: ["already-linked"] })] }];
    expect(present(linked, { ...DEFAULT_SETTINGS, firstMentionOnly: true }).noteCount).toBe(0);
    expect(present(linked, DEFAULT_SETTINGS).mainCount).toBe(1);
  });
});

describe("group helpers", () => {
  it("finds names repeated in two folders", () => {
    const g = (path: string) => ({ path, items: [] });
    expect([...duplicateNames([g("أ/المعنى.md"), g("ب/المعنى.md"), g("ج.md")])]).toEqual(["المعنى"]);
  });

  it("shows five cards, or all when only one or two would remain", () => {
    expect(visibleCount(12, false)).toBe(5);
    expect(visibleCount(7, false)).toBe(7);
    expect(visibleCount(12, true)).toBe(12);
  });
});
