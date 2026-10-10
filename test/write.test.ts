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
    expect(locate(doc, loc)).toEqual({ ok: true, start, end: start + word.length, moved: false });
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
