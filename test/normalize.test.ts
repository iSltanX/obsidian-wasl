import { describe, expect, it } from "vitest";
import {
  foldInitialHamza,
  hasLetter,
  normalize,
  originalRange,
  tokenize,
  vowelsOf,
} from "../src/core/normalize";

describe("normalize: الفئة (أ)", () => {
  it("يحذف الحركات ويسجّلها على حرفها", () => {
    const n = normalize("الكِتابةُ");
    expect(n.text).toBe("الكتابة");
    expect(n.marks).toEqual(["", "", "ِ", "", "", "", "ُ"]);
    expect(n.map).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  it("يحذف التطويل والمحارف الخفية مع حفظ المواضع", () => {
    const n = normalize("الجسـد");
    expect(n.text).toBe("الجسد");
    expect(n.map).toEqual([0, 1, 2, 3, 5]);
    const r = normalize("‏المعرفة");
    expect(r.text).toBe("المعرفة");
    expect(r.map[0]).toBe(1);
  });

  it("يوحّد أشكال العرض إلى الحروف الأصلية", () => {
    const n = normalize("ﺍﻟﺠﺴﺪ لا");
    expect(n.text).toBe("الجسد لا");
    expect(n.map.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("يفكّ اللام ألف المركّبة إلى حرفين بالموضع نفسه", () => {
    const n = normalize("ﻻ");
    expect(n.text).toBe("لا");
    expect(n.map).toEqual([0, 0]);
  });

  it("يوحّد الأرقام العربية والفارسية إلى لاتينية", () => {
    expect(normalize("٢٠٣٠ ۲۰۲۵ 7").text).toBe("2030 2025 7");
  });

  it("يوحّد الكاف والياء الفارسيتين وحالة اللاتينية، حتى في أشكال العرض، وألف الوصل", () => {
    expect(normalize("الکتابة الحریة WRITING").text).toBe("الكتابة الحرية writing");
    expect(normalize("\ufb8e\ufbfc").text).toBe("كي"); // ﮎ ﯼ
    expect(normalize("ٱلْكِتَاب").text).toBe("الكتاب");
  });

  it("الفاصل بلا عرض يفصل الكلمات ولا يصلها", () => {
    expect(normalize("كتاب\u200bجديد").text).toBe("كتاب جديد");
    expect(normalize("كتا\u200cب").text).toBe("كتاب"); // فاصل عدم الوصل يبقى واصلًا للحروف
  });

  it("لا يحذف الهمزات ويركّب المفككة منها", () => {
    expect(normalize("سأل مسؤول إنسان").text).toBe("سأل مسؤول إنسان");
    expect(normalize("أمل").text).toBe("أمل");
    expect(normalize("ؤ").text).toBe("ؤ");
  });

  it("يجمع المسافات المتتالية ويبقي السطر الجديد", () => {
    const n = normalize("رؤية   2030\n\nنص");
    expect(n.text).toBe("رؤية 2030\n\nنص");
  });

  it("خريطة المواضع تعيد المقطع الأصلي بحركاته الأخيرة", () => {
    const doc = "وبالكتابةِ أفهم";
    const n = normalize(doc);
    const [s, e] = originalRange(n, doc, 0, 9);
    expect(doc.slice(s, e)).toBe("وبالكتابةِ");
  });
});

describe("tokenize", () => {
  it("يقطّع على غير حروف الكلمة", () => {
    const text = normalize("| الكتابة | فعل، ثم Python3 |").text;
    expect(tokenize(text).map((t) => text.slice(t.s, t.e))).toEqual(["الكتابة", "فعل", "ثم", "python3"]);
  });
});

describe("أدوات صغيرة", () => {
  it("vowelsOf يستبعد الشدة والتنوين ويرتّب", () => {
    expect(vowelsOf("َّ")).toBe("َ");
    expect(vowelsOf("ّ")).toBe("");
    expect(vowelsOf("ً")).toBe("");
    expect(vowelsOf("")).toBe("");
  });
  it("foldInitialHamza يوحّد أول الكلمة فقط", () => {
    expect(foldInitialHamza("إنسان")).toBe("انسان");
    expect(foldInitialHamza("آمال")).toBe("امال");
    expect(foldInitialHamza("سأل")).toBe("سأل");
  });
  it("hasLetter", () => {
    expect(hasLetter("2030")).toBe(false);
    expect(hasLetter("رؤية 2030")).toBe(true);
  });
});
