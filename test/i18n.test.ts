import { describe, expect, it } from "vitest";
import { resolveLang, strings } from "../src/plugin/i18n";

describe("language", () => {
  it("follows Obsidian when automatic", () => {
    expect(resolveLang("auto", "ar")).toBe("ar");
    expect(resolveLang("auto", "ar-SA")).toBe("ar");
    expect(resolveLang("auto", "en")).toBe("en");
    expect(resolveLang("en", "ar")).toBe("en");
  });
});

describe("Arabic counts", () => {
  const ar = strings("ar");
  it("uses the right noun form after each number", () => {
    expect(ar.mentions(1)).toBe("موضع واحد");
    expect(ar.mentions(2)).toBe("موضعان");
    expect(ar.mentions(3)).toBe("٣ مواضع");
    expect(ar.mentions(11)).toBe("١١ موضعًا");
    expect(ar.mentions(100)).toBe("١٠٠ موضع");
    expect(ar.notes(2)).toBe("ملاحظتين");
    expect(ar.notes(222)).toBe("٢٢٢ ملاحظة");
  });

  it("fills numbers with Arabic-Indic digits", () => {
    expect(ar.t("scanning", { done: 40, notes: ar.notes(222) })).toBe("يبحث… ٤٠ من ٢٢٢ ملاحظة");
    expect(ar.t("none", { name: "الكتابة", notes: ar.notes(3) })).toBe("لم يُعثر على ذكر بلا رابط لـ«الكتابة» في ٣ ملاحظات.");
  });
});

describe("English counts", () => {
  const en = strings("en");
  it("uses singular and plural", () => {
    expect(en.mentions(1)).toBe("1 mention");
    expect(en.mentions(34)).toBe("34 mentions");
    expect(en.notes(1)).toBe("1 note");
  });
});

describe("summary with possible mentions", () => {
  const ar = strings("ar");
  it("agrees number, noun and adjective", () => {
    const line = (all: number, notes: number, possible: number) =>
      ar.t("summary", { mentions: ar.mentions(all), notes: ar.notes(notes) }) + ar.possibleOf(possible);
    expect(line(39, 12, 5)).toBe("٣٩ موضعًا في ١٢ ملاحظة، منها ٥ مواضع محتملة");
    expect(line(2, 1, 0)).toBe("موضعان في ملاحظة واحدة");
    expect(line(14, 2, 11)).toBe("١٤ موضعًا في ملاحظتين، منها ١١ موضعًا محتملًا");
  });
});
