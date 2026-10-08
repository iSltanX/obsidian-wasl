import { describe, expect, it } from "vitest";
import { firstStrongDir, snippetFor, withContext } from "../src/plugin/context";
import type { Mention } from "../src/core/match";

const at = (doc: string, word: string): [number, number] => {
  const s = doc.indexOf(word);
  return [s, s + word.length];
};

describe("snippet", () => {
  it("keeps a short line whole and marks the match", () => {
    const doc = "سطر أول\nثم عاد وبالكتابةِ نجا.\nسطر ثالث";
    const [s, e] = at(doc, "وبالكتابةِ");
    const sn = snippetFor(doc, s, e);
    expect(sn).toMatchObject({ text: "ثم عاد وبالكتابةِ نجا.", cutStart: false, cutEnd: false, dir: "rtl" });
    expect(sn.text.slice(sn.matchStart, sn.matchEnd)).toBe("وبالكتابةِ");
  });

  it("cuts long lines at word boundaries and reports the cuts", () => {
    const doc = "كلمة ".repeat(40) + "الكتابة" + " نص".repeat(40);
    const [s, e] = at(doc, "الكتابة");
    const sn = snippetFor(doc, s, e, 20);
    expect(sn.cutStart && sn.cutEnd).toBe(true);
    expect(sn.text.startsWith("كلمة")).toBe(true);
    expect(sn.text.endsWith("نص")).toBe(true);
    expect(sn.text.slice(sn.matchStart, sn.matchEnd)).toBe("الكتابة");
    expect(sn.text.length).toBeLessThan(50);
  });

  it("never starts a cut with a lone diacritic", () => {
    const doc = "كَتَبَ".repeat(30) + " الكتابة";
    const [s, e] = at(doc, "الكتابة");
    const first = snippetFor(doc, s, e, 7).text.charCodeAt(0);
    expect(first >= 0x064b && first <= 0x065f).toBe(false);
  });

  it("drops a trailing carriage return", () => {
    const doc = "قبل الكتابة بعد\r\nسطر";
    const [s, e] = at(doc, "الكتابة");
    expect(snippetFor(doc, s, e).text).toBe("قبل الكتابة بعد");
  });

  it("takes the direction from the whole line, not the cut part", () => {
    const doc = "قال " + "Python ".repeat(20) + "الكتابة";
    const [s, e] = at(doc, "الكتابة");
    const sn = snippetFor(doc, s, e, 20);
    expect(sn.text.startsWith("Python")).toBe(true);
    expect(sn.dir).toBe("rtl");
  });
});

describe("firstStrongDir", () => {
  it("skips digits, marks and punctuation", () => {
    expect(firstStrongDir("٢٠٢٦ - Python")).toBe("ltr");
    expect(firstStrongDir("- «الكتابة»")).toBe("rtl");
    expect(firstStrongDir("123 ...")).toBe(null);
  });
});

describe("withContext", () => {
  it("numbers lines from zero in order", () => {
    const doc = "أ\nالكتابة هنا\nب\nج الكتابة";
    const m = (from: number): Mention => {
      const s = doc.indexOf("الكتابة", from);
      return { path: "t.md", name: "الكتابة", isAlias: false, start: s, end: s + 7, surface: "الكتابة", layer: 0, reasons: [], flags: [] };
    };
    const first = m(0);
    expect(withContext(doc, [first, m(first.end)]).map((f) => f.line)).toEqual([1, 3]);
  });
});

describe("snippet edges from review", () => {
  it("does not mark spaces at the line ends as a cut", () => {
    const doc = " ".repeat(80) + "الكتابة" + " ".repeat(80);
    const sn = snippetFor(doc, 80, 87, 20);
    expect([sn.text, sn.cutStart, sn.cutEnd]).toEqual(["الكتابة", false, false]);
  });

  it("stays linear on a very long line with many mentions", () => {
    const unit = "الكتابة ونص ";
    const doc = unit.repeat(40_000); // نحو نصف مليون حرف في سطر واحد
    const mentions: Mention[] = [];
    for (let s = 0; s < doc.length; s += unit.length)
      mentions.push({ path: "t.md", name: "الكتابة", isAlias: false, start: s, end: s + 7, surface: "الكتابة", layer: 0, reasons: [], flags: [] });
    const t0 = performance.now();
    const found = withContext(doc, mentions);
    expect(found.length).toBe(40_000);
    expect(found[20_000]?.snippet.cutStart).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
