import { describe, expect, it } from "vitest";
import { buildIndex, makeEntry, nameKey } from "../src/core/index";

const note = (title: string, aliases: string[] = [], path = title + ".md") => ({ path, title, aliases });

describe("فهرس الأسماء", () => {
  it("يحذف «ال» من العنوان المعرّف ويحفظ النواة بهمزتها", () => {
    const e = makeEntry(note("الإنسان"), "الإنسان", false)!;
    expect(e.definite).toBe(true);
    expect(e.core).toBe("إنسان");
    expect(e.coreKey).toBe("انسان");
    expect(e.arabicCore).toBe(true);
  });

  it("لا يعدّ الاسم القصير معرّفًا إن لم تبق نواة من حرفين («الم»)", () => {
    expect(makeEntry(note("الم"), "الم", false)!.definite).toBe(false);
    expect(makeEntry(note("الله"), "الله", false)!.core).toBe("له");
  });

  it("يقسم العنوان المركّب إلى نواة وبقية وفواصل", () => {
    const e = makeEntry(note("رؤية 2030"), "رؤية 2030", false)!;
    expect(e.core).toBe("رؤية");
    expect(e.rest).toEqual(["2030"]);
    expect(e.seps).toEqual([" "]);
    const k = makeEntry(note("الكتابة الحسية"), "الكتابة الحسية", false)!;
    expect(k.core).toBe("كتابة");
    expect(k.rest).toEqual(["الحسية"]);
  });

  it("الاسم اللاتيني يُفهرس بحروف صغيرة ونواته غير عربية", () => {
    const e = makeEntry(note("Python"), "Python", false)!;
    expect(e.coreKey).toBe("python");
    expect(e.arabicCore).toBe(false);
  });

  it("يرفض الأسماء التي لا تحدّها كلمات أو بلا حروف", () => {
    expect(makeEntry(note("C++"), "C++", false)).toBeNull();
    expect(makeEntry(note(".NET"), ".NET", false)).toBeNull();
    expect(makeEntry(note("2030"), "2030", false)).toBeNull();
    expect(makeEntry(note("  "), "  ", false)).toBeNull();
  });

  it("يقصّ الرموز والترقيم المحيط بالكلمات من مفتاح البحث", () => {
    const e = makeEntry(note("📚 كتب"), "📚 كتب", false)!;
    expect(e.core).toBe("كتب");
    expect(e.key).toBe("كتب");
    expect(makeEntry(note("ما هو؟"), "ما هو؟", false)!.rest).toEqual(["هو"]);
    const v = makeEntry(note("«الدَّرَج»"), "«الدَّرَج»", false)!;
    expect(v.core).toBe("درج");
    expect(v.vowels).toEqual([["َ", "َ", ""]]);
    expect(makeEntry(note("Go!"), "Go!", false)).toBeNull();
  });

  it("يسجّل حركات العنوان ويعرف إن كان مشكولًا عمدًا", () => {
    const e = makeEntry(note("الدَّرَج"), "الدَّرَج", false)!;
    expect(e.core).toBe("درج");
    expect(e.vowels).toEqual([["َ", "َ", ""]]);
    expect(e.vocalized).toBe(true);
    // حركة على الحرف الأخير وحده إعراب لا تمييز، والتنوين إعراب أينما وقع
    expect(makeEntry(note("كتابٌ"), "كتابٌ", false)!.vocalized).toBe(false);
    expect(makeEntry(note("كتابًا"), "كتابًا", false)!.vocalized).toBe(false);
    expect(makeEntry(note("حُبّ"), "حُبّ", false)!.vowels).toEqual([["ُ", ""]]);
  });

  it("يفهرس الأسماء البديلة ويجمع ما يشترك في النواة", () => {
    const idx = buildIndex([note("الفينومينولوجيا", ["الظاهراتية"]), note("الكتابة", ["writing", "Writing"])]);
    expect(idx.size).toBe(4);
    expect(idx.byCore.get("ظاهراتية")![0]!.isAlias).toBe(true);
    expect(idx.byCore.get("writing")!.length).toBe(1);
    expect(idx.keysByPath.get("الكتابة.md")).toEqual(new Set(["الكتابة", "writing"]));
  });

  it("يكتشف العناوين المكررة في مجلدين ويفهرس الأهداف فقط", () => {
    const idx = buildIndex(
      [note("المعنى", [], "مجلد أ/المعنى.md"), note("المعنى", [], "مجلد ب/المعنى.md"), note("الجسد")],
      ["مجلد أ/المعنى.md"],
    );
    expect(idx.ambiguousTitles.has("المعنى")).toBe(true);
    expect(idx.size).toBe(1);
    expect(idx.byCore.has("جسد")).toBe(false);
  });

  it("nameKey يطبّع ويقصّ", () => {
    expect(nameKey(" الكِتابة ")).toBe("الكتابة");
  });
});
