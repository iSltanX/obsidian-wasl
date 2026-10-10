import { describe, expect, it } from "vitest";
import { snippetFor, type Found } from "../src/plugin/context";
import { fingerprint, formKey, IgnoreList } from "../src/plugin/ignore";

function foundIn(doc: string, word: string, path = "الكتابة.md"): Found {
  const start = doc.indexOf(word);
  const end = start + word.length;
  return { path, name: "الكتابة", isAlias: false, start, end, surface: word, layer: 1, reasons: [], flags: [], line: 0, snippet: snippetFor(doc, start, end) };
}

const T = "ملاحظات/الكتابة.md";
const S = "فصول/فصل 3.md";

describe("fingerprint", () => {
  const m = foundIn("ثم عاد إلى دفتره وبالكتابةِ وحدها نجا.", "وبالكتابةِ");

  it("ignores diacritics and spacing differences nearby", () => {
    const n = foundIn("ثم عادَ  إلى دفترِه وبالكتابة وحدها نجا.", "وبالكتابة");
    expect(fingerprint(n.surface, n.snippet)).toBe(fingerprint(m.surface, m.snippet));
  });

  it("changes when the words around the mention change", () => {
    const n = foundIn("ثم عاد إلى أوراقه وبالكتابةِ وحدها نجا.", "وبالكتابةِ");
    expect(fingerprint(n.surface, n.snippet)).not.toBe(fingerprint(m.surface, m.snippet));
  });

  it("changes when a different form sits in the same place", () => {
    const n = foundIn("ثم عاد إلى دفتره كتابةٌ وحدها نجا.", "كتابةٌ");
    expect(fingerprint(n.surface, n.snippet)).not.toBe(fingerprint(m.surface, m.snippet));
  });

  it("does not depend on text far from the mention", () => {
    const sentence = "ثم عاد في المساء إلى دفتره القديم وبالكتابةِ وحدها نجا من كل شيء كان يثقله.";
    const a = foundIn("مقدمة طويلة جدًا تسبق الجملة ".repeat(3) + sentence + " وخاتمة طويلة تلحقها.", "وبالكتابةِ");
    const b = foundIn("تمهيد آخر مختلف تمامًا يسبق الجملة ".repeat(2) + sentence + " ثم كلام آخر.", "وبالكتابةِ");
    expect(fingerprint(a.surface, a.snippet)).toBe(fingerprint(b.surface, b.snippet));
  });
});

describe("IgnoreList", () => {
  const m = foundIn("ثم عاد إلى دفتره وبالكتابةِ وحدها نجا.", "وبالكتابةِ");

  it("hides a mention by its context and brings it back when the context changes", () => {
    const list = new IgnoreList();
    expect(list.ignoreMention(T, S, fingerprint(m.surface, m.snippet))).toBe(true);
    expect(list.ignoreMention(T, S, fingerprint(m.surface, m.snippet))).toBe(false);
    expect(list.isIgnored(T, S, m)).toBe("mention");
    expect(list.isIgnored(T, "آخر.md", m)).toBeNull();
    const moved = foundIn("ثم عاد إلى أوراقه وبالكتابةِ وحدها نجا.", "وبالكتابةِ");
    expect(list.isIgnored(T, S, moved)).toBeNull();
  });

  it("hides a word for a target in every note", () => {
    const list = new IgnoreList();
    list.ignoreForm(T, formKey("كتابةٌ"));
    const a = foundIn("هذه كتابةٌ بلا جمهور", "كتابةٌ");
    const b = foundIn("كتابة في الليل", "كتابة");
    expect(list.isIgnored(T, S, a)).toBe("form");
    expect(list.isIgnored(T, "آخر.md", b)).toBe("form");
    expect(list.isIgnored(T, S, m)).toBeNull();
    expect(list.unignore(T, S, a)).toBe(true);
    expect(list.isIgnored(T, "آخر.md", b)).toBeNull();
  });

  it("follows renames of notes and folders and forgets deleted ones", () => {
    const list = new IgnoreList();
    list.ignoreMention(T, S, "f");
    list.ignoreForm(T, "w");
    expect(list.rename("فصول", "أجزاء")).toBe(true);
    expect(list.rename("ملاحظات/الكتابة.md", "الكتابة.md")).toBe(true);
    expect(list.rename("x.md", "y.md")).toBe(false);
    expect(list.toJSON()).toEqual({ mentions: [{ t: "الكتابة.md", s: "أجزاء/فصل 3.md", f: "f" }], forms: [{ t: "الكتابة.md", w: "w" }] });
    expect(list.drop("أجزاء")).toBe(true);
    expect(list.toJSON().mentions).toEqual([]);
    expect(list.drop("الكتابة.md")).toBe(true);
    expect(list.size).toBe(0);
  });

  it("removes both rules at once when a mention is hidden twice", () => {
    const list = new IgnoreList();
    list.ignoreForm(T, formKey(m.surface));
    list.ignoreMention(T, S, fingerprint(m.surface, m.snippet));
    expect(list.unignore(T, S, m)).toBe(true);
    expect(list.isIgnored(T, S, m)).toBeNull();
    expect(list.size).toBe(0);
  });

  it("handles nested folders, look-alike siblings and repeated events", () => {
    const list = new IgnoreList();
    list.ignoreMention("فصول/أ/الهدف.md", "فصول/ب.md", "f");
    list.ignoreMention("فصول 2/x.md", "فصول.md", "g");
    expect(list.rename("فصول", "أجزاء")).toBe(true);
    expect(list.toJSON().mentions).toEqual([
      { t: "أجزاء/أ/الهدف.md", s: "أجزاء/ب.md", f: "f" },
      { t: "فصول 2/x.md", s: "فصول.md", f: "g" },
    ]);
    // حدث الملف الفرعي بعد حدث المجلد: لا أثر ثانٍ
    expect(list.rename("فصول/أ/الهدف.md", "أجزاء/أ/الهدف.md")).toBe(false);
    const v = list.version;
    expect(list.rename("لا شيء", "آخر")).toBe(false);
    expect(list.version).toBe(v);
  });

  it("reads stored data and skips broken entries", () => {
    const list = IgnoreList.read({ mentions: [{ t: T, s: S, f: "f" }, { t: T }, 3], forms: [{ t: T, w: "w" }, { t: 1, w: "x" }] });
    expect(list.toJSON()).toEqual({ mentions: [{ t: T, s: S, f: "f" }], forms: [{ t: T, w: "w" }] });
    expect(IgnoreList.read(undefined).size).toBe(0);
  });
});
