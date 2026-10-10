import { describe, expect, it } from "vitest";
import { snippetFor } from "../src/plugin/context";
import { applyLink, locate, locatorOf, type Locator } from "../src/plugin/write";

const doc = "سطر أول\nثم عاد إلى دفتره وبالكتابةِ وحدها نجا.\nسطر ثالث";
const word = "وبالكتابةِ";
const start = doc.indexOf(word);
const loc: Locator = locatorOf(start, word, snippetFor(doc, start, start + word.length));
const link = "[[الكتابة|وبالكتابةِ]]";

describe("locate", () => {
  it("accepts the recorded position when the context is unchanged", () => {
    expect(locate(doc, loc)).toEqual({ ok: true, start, end: start + word.length, moved: false, inTable: false });
  });

  it("finds the mention again when text was inserted before it", () => {
    const shifted = "فقرة جديدة في الأعلى.\n" + doc;
    const r = locate(shifted, loc);
    expect(r).toMatchObject({ ok: true, moved: true, start: start + "فقرة جديدة في الأعلى.\n".length });
  });

  it("refuses when the context is gone", () => {
    expect(locate(doc.replace("دفتره", "أوراقه"), loc)).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses when the context occurs twice", () => {
    const line = "ثم عاد إلى دفتره وبالكتابةِ وحدها نجا.";
    expect(locate(`${line}\n${line}`, loc)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("refuses a word that has since been joined to its neighbour", () => {
    const joined = { ...loc, before: "", after: "" };
    expect(locate("دفترهوبالكتابةِ وحدها", joined)).toEqual({ ok: false, reason: "changed" });
    expect(locate("دفتره وبالكتابةِوحدها", joined)).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses a mention that is now inside a link or code", () => {
    const linked = doc.replace(word, `[[الكتابة|${word}]]`);
    const l = { ...loc, before: "", after: "" };
    expect(locate(linked, l)).toEqual({ ok: false, reason: "protected" });
    const coded = doc.replace(word, "`" + word + "`");
    expect(locate(coded, l)).toEqual({ ok: false, reason: "protected" });
  });

  it("refuses a mention whose line became a heading", () => {
    const heading = doc.replace("ثم عاد", "## ثم عاد");
    expect(locate(heading, loc)).toEqual({ ok: false, reason: "protected" });
  });

  it("uses Obsidian metadata only while the position is unchanged", () => {
    const cache = { links: [{ position: { start: { offset: start }, end: { offset: start + word.length } }, link: "x" }] };
    expect(locate(doc, loc, cache)).toEqual({ ok: false, reason: "protected" });
    // بعد التحرّك تُهمل المواضع القديمة ويكفي الماسح الخفيف
    expect(locate("أ\n" + doc, loc, cache)).toMatchObject({ ok: true, moved: true });
  });
});

describe("locate edge cases", () => {
  it("relocates across CRLF line endings, as editor text differs from disk text", () => {
    const crlf = doc.replace(/\n/g, "\r\n");
    const onDisk = crlf.indexOf(word);
    const l = locatorOf(onDisk, word, snippetFor(crlf, onDisk, onDisk + word.length));
    expect(l.before.includes("\r") || l.after.includes("\r")).toBe(false);
    const r = locate(doc, l);
    expect(r).toMatchObject({ ok: true, moved: true, start });
  });

  it("with no context, matches the word only where it stands alone", () => {
    const bare = { ...loc, before: "", after: "" };
    // الكلمة وحدها مرة واحدة، وجزء من كلمة أطول في مكان آخر: تُربط الوحيدة الكاملة
    expect(locate("x\nوبالكتابةِ\nوبالكتابةِه هنا", bare)).toMatchObject({ ok: true, start: 2 });
    // كلمتان كاملتان: التباس
    expect(locate("وبالكتابةِ\nوبالكتابةِ", bare)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("works at the very start and end of a document", () => {
    const d = "الكتابة";
    const l = locatorOf(0, "الكتابة", snippetFor(d, 0, 7));
    expect(locate(d, l)).toMatchObject({ ok: true, start: 0, end: 7 });
    expect(locate("", l)).toEqual({ ok: false, reason: "changed" });
  });

  it("escapes the table separator by the line's state at write time, not at scan time", () => {
    const table = "| أ | ب |\n|---|---|\n| وبالكتابةِ | ج |";
    const at = table.indexOf(word);
    const l = locatorOf(at, word, snippetFor(table, at, at + word.length));
    const inTable = applyLink(table, l, link);
    expect(inTable.ok && inTable.link).toBe("[[الكتابة\\|وبالكتابةِ]]");
    // الموضع نفسه صار في سطر عادي (أُزيل الجدول حوله): بلا تهريب
    const plain = "ثم وبالكتابةِ وحدها.";
    const p = plain.indexOf(word);
    const out = applyLink(plain, locatorOf(p, word, snippetFor(plain, p, p + word.length)), link);
    expect(out.ok && out.link).toBe(link);
  });
});

describe("applyLink", () => {
  it("replaces the word with the link and nothing else", () => {
    const r = applyLink(doc, loc, link);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(doc.replace(word, link));
  });

  it("returns the failure reason and no text", () => {
    expect(applyLink(doc.replace("دفتره", "x"), loc, link)).toEqual({ ok: false, reason: "changed" });
  });

  it("keeps the line context of a match at the start and end of a line", () => {
    const d = "الكتابة فعلُ نجاة";
    const l = locatorOf(0, "الكتابة", snippetFor(d, 0, 7));
    expect(l.before).toBe("");
    const r = applyLink(d, l, "[[الكتابة]]");
    if (r.ok) expect(r.text).toBe("[[الكتابة]] فعلُ نجاة");
    expect(r.ok).toBe(true);
  });
});
