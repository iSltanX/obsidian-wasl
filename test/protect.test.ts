import { describe, expect, it } from "vitest";
import { inRanges, linkKey, mask, MASK_CHAR, protect } from "../src/core/protect";

const hidden = (doc: string, word: string): boolean => {
  const p = protect(doc);
  return inRanges(p.protected, doc.indexOf(word));
};

describe("النطاقات المحمية (الماسح)", () => {
  it("الخصائص وكتل الكود وعناوين الأقسام", () => {
    expect(hidden("---\nموضوع: الكتابة\n---\nنص.", "الكتابة")).toBe(true);
    expect(hidden("```\nالكتابة\n```", "الكتابة")).toBe(true);
    expect(hidden("~~~js\nالكتابة\n", "الكتابة")).toBe(true); // سياج غير مغلق حتى آخر الملف
    expect(hidden("## الكتابة والجسد\n\nنص محايد.", "الكتابة")).toBe(true);
    expect(hidden("#الكتابة", "الكتابة")).toBe(true); // وسم
    expect(hidden("نص الكتابة", "الكتابة")).toBe(false);
  });

  it("الروابط والتضمينات والكود المضمّن والتعليقات والرياضيات وHTML", () => {
    expect(hidden("[[مدونتي|الكتابة]]", "الكتابة")).toBe(true);
    expect(hidden("![[الكتابة]]", "الكتابة")).toBe(true);
    expect(hidden("[الكتابة](https://example.com)", "الكتابة")).toBe(true);
    expect(hidden("استعمل `الكتابة` هنا", "الكتابة")).toBe(true);
    expect(hidden("%% الكتابة %%", "الكتابة")).toBe(true);
    expect(hidden("<!-- الكتابة -->", "الكتابة")).toBe(true);
    expect(hidden("$$\\text{الكتابة}$$", "الكتابة")).toBe(true);
    expect(hidden("$الكتابة$", "الكتابة")).toBe(true);
    expect(hidden("https://example.com/الكتابة", "الكتابة")).toBe(true);
    expect(hidden("<span dir=\"rtl\">الكتابة</span>", "الكتابة")).toBe(false); // الوسم محمي لا محتواه
    expect(hidden("نص[^الكتابة] هنا", "الكتابة")).toBe(true);
    expect(hidden("نص ^الكتابة", "الكتابة")).toBe(false); // معرّف الكتلة لاتيني فقط
    expect(hidden("نص ^abc", "abc")).toBe(true);
  });

  it("الاقتباسات والتنبيهات تُوسم لا تُحمى، والجداول كذلك", () => {
    const q = protect("> الكتابة نجاة");
    expect(inRanges(q.protected, 2)).toBe(false);
    expect(inRanges(q.quotes, 2)).toBe(true);
    const callout = "> [!note]\n> الذاكرة تخون";
    const c = protect(callout);
    expect(inRanges(c.quotes, callout.indexOf("الذاكرة"))).toBe(true);
    expect(inRanges(c.protected, callout.indexOf("الذاكرة"))).toBe(false);
    const t = protect("| المفهوم | الوصف |\n|---|---|\n| الكتابة | فعل |");
    expect(inRanges(t.tables, t.tables[2]!.start + 2)).toBe(true);
    expect(inRanges(t.protected, t.tables[2]!.start + 2)).toBe(false);
  });

  it("يجمع وجهات الروابط الموجودة", () => {
    const p = protect("[[الكتابة]] و[[مجلد/الجسد.md#قسم|نص]] و[نص](%D8%A7%D9%84%D9%85%D8%B9%D9%86%D9%89.md) و[x](https://a.b)");
    expect(p.links).toEqual(new Set(["الكتابة", "الجسد", "المعنى"]));
    expect(linkKey("مجلد/الكِتابة.md#عنوان")).toBe("الكتابة");
  });

  it("يقبل بيانات شبيهة بـCachedMetadata", () => {
    const doc = "نص الكتابة هنا وبعده كود";
    const pos = (s: number, e: number) => ({ start: { offset: s }, end: { offset: e } });
    const p = protect(doc, {
      links: [{ position: pos(3, 10), link: "الجسد" }],
      sections: [
        { type: "paragraph", position: pos(0, 10) },
        { type: "code", position: pos(20, 24) },
        { type: "callout", position: pos(11, 19) },
      ],
    });
    expect(inRanges(p.protected, 5)).toBe(true);
    expect(inRanges(p.protected, 21)).toBe(true);
    expect(inRanges(p.quotes, 12)).toBe(true);
    expect(p.links.has("الجسد")).toBe(true);
  });

  it("mask يحفظ المواضع والأسطر ويعمّي بمحرف فاصل لا بمسافة", () => {
    const doc = "أ\n`ب`\nج";
    const m = mask(doc, protect(doc).protected);
    expect(m.length).toBe(doc.length);
    expect(m).toBe(`أ\n${MASK_CHAR.repeat(3)}\nج`);
    expect(mask("abcdef", [{ start: 1, end: 3 }, { start: 2, end: 5 }])).toBe(`a${MASK_CHAR.repeat(4)}f`);
  });

  it("المراحل لا تتداخل: $ داخل كود مضمّن لا يقترن بغيره، والأسعار ليست رياضيات", () => {
    expect(hidden("استعمل `$HOME` ثم `$PATH`", "ثم")).toBe(false);
    expect(hidden("سعره $5 والكتابة بسعر $10", "والكتابة")).toBe(false);
    expect(hidden("$x$ و $a+b$ و الكتابة", "الكتابة")).toBe(false);
    expect(hidden("$a+b$ و الكتابة", "a+b")).toBe(true);
    expect(hidden("```sh\necho $$\n```\nالكتابة\n$$ x $$", "الكتابة")).toBe(false);
    expect(hidden("x<y الكتابة z>w", "الكتابة")).toBe(false);
    expect(hidden("<div class=\"a\">الكتابة</div>", "class")).toBe(true);
  });

  it("سياج الإغلاق لا يقبل كلمة بعده، والروابط داخل الكود لا تُعدّ ربطًا", () => {
    const doc = "```\nx\n```js\ny\n```\nالكتابة";
    expect(hidden(doc, "الكتابة")).toBe(false);
    expect(hidden(doc, "y")).toBe(true);
    expect(protect("```\n[[الكتابة]]\n```").links.has("الكتابة")).toBe(false);
  });

  it("مفاتيح الروابط بصيغة الجداول ومعرّفات الكتل", () => {
    const p = protect("| [[الكتابة\\|وبالكتابةِ]] | [[الجسد^blk]] |");
    expect(p.links).toEqual(new Set(["الكتابة", "الجسد"]));
  });

  it("ميزانية زمنية على مدخلات عدائية", () => {
    const docs = ["[".repeat(100_000), "![a](".repeat(30_000), "<!-- ".repeat(50_000), "$".repeat(50_000), "`".repeat(50_000)];
    for (const doc of docs) {
      const t = Date.now();
      protect(doc);
      expect(Date.now() - t, doc.slice(0, 5)).toBeLessThan(1000);
    }
  });
});
