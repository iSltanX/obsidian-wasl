import { describe, expect, it } from "vitest";
import { buildIndex, type NoteInput } from "../src/core/index";
import { findMentions, type Mention } from "../src/core/match";

const note = (title: string, extra: Partial<NoteInput> = {}): NoteInput => ({ path: title + ".md", title, aliases: [], ...extra });
const find = (doc: string, n: NoteInput, sourcePath?: string): Mention[] => findMentions(doc, buildIndex([n]), { sourcePath });
const one = (doc: string, n: NoteInput): Mention => {
  const m = find(doc, n);
  expect(m).toHaveLength(1);
  return m[0] as Mention;
};
const codes = (m: Mention): string[] => m.reasons.map((r) => r.code);

describe("سلاسل السوابق", () => {
  it("كل السلاسل المغلقة على عنوان معرّف", () => {
    for (const w of ["والكتابة", "فالكتابة", "بالكتابة", "كالكتابة", "للكتابة", "وبالكتابة", "فكالكتابة", "وللكتابة", "فللكتابة"]) {
      const m = one(`قلت ${w} أمس`, note("الكتابة"));
      expect(m.layer, w).toBe(1);
      expect(m.surface, w).toBe(w);
      expect(codes(m), w).toContain("prefix");
    }
    expect(codes(one("فللكتابة", note("الكتابة")))).toContain("lam-lam");
  });

  it("«لل» المدمجة على كلمة تبدأ بلام: للغة = ل + اللغة", () => {
    const m = one("كتب للغة قاموسًا", note("اللغة"));
    expect(m.layer).toBe(1);
    expect(m.surface).toBe("للغة");
    expect(codes(m)).toEqual(expect.arrayContaining(["prefix", "lam-lam"]));
    // مع عنوان نكرة تبقى قراءة «ل + لغة» وحدها: سابقة مفردة على ثلاثة أحرف
    const i = one("للغة", note("لغة"));
    expect(i.layer).toBe(2);
    expect(codes(i)).not.toContain("lam-lam");
  });

  it("السابقة على الكلمة الأولى فقط في العنوان المركّب", () => {
    expect(one("وبالذاكرة الجمعية", note("الذاكرة الجمعية")).surface).toBe("وبالذاكرة الجمعية");
    expect(find("الذاكرة والجمعية", note("الذاكرة الجمعية"))).toHaveLength(0);
    expect(find("الذاكرة\nالجمعية", note("الذاكرة الجمعية"))).toHaveLength(0);
  });

  it("النكرة لا تُقترح إلا بخيار الملاحظة", () => {
    expect(find("كتابة", note("الكتابة"))).toHaveLength(0);
    const m = one("كتابة", note("الكتابة", { indefinite: true }));
    expect(m.layer).toBe(1);
    expect(codes(m)).toContain("indefinite");
    expect(one("وبكتابة", note("الكتابة", { indefinite: true })).layer).toBe(1);
  });

  it("التعريف على عنوان نكرة طبقة ١، و«مطابقة تامة فقط» تسقطه", () => {
    expect(one("المال", note("مال")).layer).toBe(1);
    expect(codes(one("المال", note("مال")))).toContain("definite");
    expect(find("المال", note("مال", { exactOnly: true }))).toHaveLength(0);
    expect(one("مال", note("مال", { exactOnly: true })).layer).toBe(0);
    expect(find("بمال", note("مال", { exactOnly: true }))).toHaveLength(0);
    expect(find("امل", note("أمل", { exactOnly: true }))).toHaveLength(0);
  });

  it("قواعد الحماية: نواة من حرفين، وسابقة مفردة على ثلاثة أحرف", () => {
    expect(find("وحر", note("حر"))).toHaveLength(0);
    expect(find("والحر", note("الحر"))).toHaveLength(1); // «ال» مرساة كافية
    expect(one("كمال", note("مال")).layer).toBe(2);
    expect(one("وبمال", note("مال")).layer).toBe(1); // سابقتان
    expect(one("ومالك", note("مالك")).layer).toBe(1); // أربعة أحرف
  });

  it("الهمزة الأولى بالاتجاهين وترفع الطبقة ٠ إلى ١", () => {
    const m = one("امل", note("أمل"));
    expect(m.layer).toBe(1);
    expect(codes(m)).toContain("initial-hamza");
    expect(one("أمل", note("امل")).layer).toBe(1);
    expect(one("الامل", note("الأمل")).layer).toBe(1);
    expect(find("سال", note("سأل"))).toHaveLength(0);
  });

  it("اللواحق الضميرية طبقة ٢ مع قلب ة إلى ت", () => {
    const m = one("ذاكرته ضعيفة", note("الذاكرة"));
    expect(m.layer).toBe(2);
    expect(m.surface).toBe("ذاكرته");
    expect(codes(m)).toContain("suffix");
    expect(one("وبجسدها", note("الجسد")).layer).toBe(2);
    expect(find("بيته", note("بت"))).toHaveLength(0);
    expect(find("ذاكرتهم", note("الذاكرة الجمعية"))).toHaveLength(0);
  });
});

describe("التشكيل", () => {
  it("حركات النص تُتجاهل إن لم يُشكَّل العنوان", () => {
    const m = one("الكِتابةُ", note("الكتابة"));
    expect(m.layer).toBe(0);
    expect(codes(m)).toContain("diacritics");
  });

  it("عنوان مشكول: تعارض يُسقط، وغياب التشكيل ينزل إلى ٢ موسومًا، والتطابق يبقى ٠", () => {
    const t = note("الدَّرَج");
    expect(find("الدُّرج", t)).toHaveLength(0);
    expect(find("الدِرَج", t)).toHaveLength(0);
    const u = one("الدرج", t);
    expect(u.layer).toBe(2);
    expect(u.flags).toContain("unvocalized");
    expect(one("الدَّرَجَ", t).layer).toBe(0);
    expect(one("الدَّرَجُ", t).layer).toBe(0); // حركة الحرف الأخير إعراب
    expect(one("الدَرَج", t).layer).toBe(0); // الشدة ليست حركة صوتية
  });

  it("يقارن كل كلمة في العنوان المركّب", () => {
    const t = note("عِلْم الجَمال");
    expect(find("عَلَم الجمال", t)).toHaveLength(0);
    expect(one("عِلْم الجَمال", t).layer).toBe(0);
    expect(one("علم الجمال", t).layer).toBe(2);
  });
});

describe("الأعلام والسياق", () => {
  it("الملاحظة الهدف نفسها لا تُقترح", () => {
    expect(find("الكتابة هنا", note("الكتابة"), "الكتابة.md")).toHaveLength(0);
    expect(find("الكتابة هنا", note("الكتابة"), "أخرى.md")).toHaveLength(1);
  });

  it("مربوطة في هذه الملاحظة عبر العنوان أو الاسم البديل", () => {
    const t = note("الكتابة", { aliases: ["writing"] });
    expect(one("[[writing]] ثم الكتابة", t).flags).toContain("already-linked");
    expect(one("الكتابة فقط", t).flags).not.toContain("already-linked");
  });

  it("ملاحظتان بالاسم نفسه", () => {
    const idx = buildIndex([note("المعنى", { path: "أ/المعنى.md" }), note("المعنى", { path: "ب/المعنى.md" })], ["أ/المعنى.md"]);
    const m = findMentions("المعنى يتشكل", idx);
    expect(m).toHaveLength(1);
    expect(m[0]!.flags).toContain("ambiguous-target");
  });

  it("أفضل مطابقة واحدة لكل كلمة وهدف: العنوان قبل الاسم البديل", () => {
    const m = one("الكتابة", note("الكتابة", { aliases: ["كتابة"], indefinite: true }));
    expect(m.isAlias).toBe(false);
    expect(m.layer).toBe(0);
  });

  it("ملاحظتان مختلفتان تطابقان الكلمة نفسها تُعادان معًا", () => {
    const idx = buildIndex([note("الكتابة"), note("الكتابة الحسية")]);
    const m = findMentions("بالكتابة الحسية", idx);
    expect(m.map((x) => x.path).sort()).toEqual(["الكتابة الحسية.md", "الكتابة.md"]);
  });

  it("المواضع صحيحة مع محارف خارج المستوى الأساسي قبل الكلمة", () => {
    const doc = "😀 وبالكتابةِ أفهم";
    const m = one(doc, note("الكتابة"));
    expect(doc.slice(m.start, m.end)).toBe("وبالكتابةِ");
  });
});
