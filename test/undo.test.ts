import { describe, expect, it } from "vitest";
import { revertLink, UndoLog, type LinkRecord } from "../src/plugin/undo";

const rec = (path: string, start = 0, ctx = { before: "", after: "" }): LinkRecord => ({ path, start, surface: "وبالكتابةِ", link: "[[الكتابة|وبالكتابةِ]]", ...ctx, at: 1 });

describe("UndoLog", () => {
  it("keeps the most recent records only", () => {
    const log = new UndoLog(2);
    log.push(rec("أ.md"));
    log.push(rec("ب.md"));
    log.push(rec("ج.md"));
    expect(log.size).toBe(2);
    expect(log.pop()?.path).toBe("ج.md");
    expect(log.last?.path).toBe("ب.md");
  });

  it("follows renamed files and folders and forgets deleted ones", () => {
    const log = new UndoLog();
    log.push(rec("فصول/أ.md"));
    log.push(rec("ب.md"));
    log.rename("فصول", "أجزاء");
    log.rename("ب.md", "ج.md");
    expect([log.pop()?.path, log.pop()?.path]).toEqual(["ج.md", "أجزاء/أ.md"]);
    log.push(rec("فصول/أ.md"));
    log.drop("فصول");
    expect(log.size).toBe(0);
  });
});

describe("revertLink", () => {
  const doc = "ثم عاد [[الكتابة|وبالكتابةِ]] وحدها.";
  const r = rec("x.md", doc.indexOf("[["), { before: "ثم عاد ", after: " وحدها." });

  it("puts the word back when the link is still where it was written", () => {
    const v = revertLink(doc, r);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.text).toBe("ثم عاد وبالكتابةِ وحدها.");
  });

  it("finds a link that moved, if it is unique", () => {
    const v = revertLink("سطر\n" + doc, r);
    expect(v.ok && v.text).toBe("سطر\nثم عاد وبالكتابةِ وحدها.");
  });

  it("refuses when the link changed or occurs twice", () => {
    expect(revertLink(doc.replace("|وبالكتابةِ", "|بالكتابة"), r)).toEqual({ ok: false, reason: "changed" });
    expect(revertLink(doc + "\n" + doc, { ...r, start: 999 })).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("leaves an identical link the user wrote elsewhere alone", () => {
    // الرابط المسجّل أُزيل بيد المستخدم، وبقي رابط مطابق له في سياق آخر
    const d = "ثم عاد وبالكتابةِ وحدها.\nوفي الختام [[الكتابة|وبالكتابةِ]] أيضًا.";
    expect(revertLink(d, r)).toEqual({ ok: false, reason: "changed" });
  });
});
