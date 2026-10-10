import { describe, expect, it } from "vitest";
import { escapeForTable, fullPathLink, linkFormat, linkTargetPath, previewAfter } from "../src/plugin/link";

describe("linkFormat", () => {
  it("tells wikilinks from Markdown links", () => {
    expect(linkFormat("[[الكتابة|وبالكتابةِ]]")).toBe("wiki");
    expect(linkFormat("![[صورة.png]]")).toBe("wiki");
    expect(linkFormat("[وبالكتابةِ](الكتابة.md)")).toBe("markdown");
  });
});

describe("escapeForTable", () => {
  it("escapes the alias separator inside tables", () => {
    expect(escapeForTable("[[الكتابة|وبالكتابةِ]]")).toBe("[[الكتابة\\|وبالكتابةِ]]");
  });

  it("leaves links without a separator and Markdown links alone", () => {
    expect(escapeForTable("[[الكتابة]]")).toBe("[[الكتابة]]");
    expect(escapeForTable("[وبالكتابةِ](الكتابة.md)")).toBe("[وبالكتابةِ](الكتابة.md)");
  });

  it("does not double-escape", () => {
    expect(escapeForTable("[[الكتابة\\|وبالكتابةِ]]")).toBe("[[الكتابة\\|وبالكتابةِ]]");
  });
});

describe("fullPathLink", () => {
  it("writes a wikilink with the full path and the surface as alias", () => {
    expect(fullPathLink("wiki", "مجلد أ/المعنى.md", "بالمعنى")).toBe("[[مجلد أ/المعنى|بالمعنى]]");
  });

  it("omits the alias when the surface is the file name", () => {
    expect(fullPathLink("wiki", "مجلد أ/المعنى.md", "المعنى")).toBe("[[مجلد أ/المعنى]]");
  });

  it("escapes spaces and parentheses in Markdown paths like Obsidian, keeping Arabic letters", () => {
    expect(fullPathLink("markdown", "مجلد أ/المعنى (1).md", "بالمعنى")).toBe("[بالمعنى](مجلد%20أ/المعنى%20%281%29.md)");
  });
});

describe("previewAfter", () => {
  it("replaces the match with the link and reports where it sits", () => {
    const snippet = { text: "ثم عاد وبالكتابةِ نجا.", matchStart: 7, matchEnd: 17, cutStart: false, cutEnd: false, dir: "rtl" as const };
    const p = previewAfter(snippet, "[[الكتابة|وبالكتابةِ]]");
    expect(p.text).toBe("ثم عاد [[الكتابة|وبالكتابةِ]] نجا.");
    expect(p.text.slice(p.linkStart, p.linkEnd)).toBe("[[الكتابة|وبالكتابةِ]]");
  });
});

describe("linkTargetPath", () => {
  it("reads the target out of both link forms", () => {
    expect(linkTargetPath("[[مجلد أ/المعنى|بالمعنى]]")).toBe("مجلد أ/المعنى");
    expect(linkTargetPath("[[الكتابة#قسم|نص]]")).toBe("الكتابة");
    expect(linkTargetPath("[بالمعنى](%D9%85%D8%AC%D9%84%D8%AF%20%D8%A3/%D8%A7%D9%84%D9%85%D8%B9%D9%86%D9%89.md)")).toBe("مجلد أ/المعنى.md");
    expect(linkTargetPath("[نص](<مجلد أ/المعنى.md>)")).toBe("مجلد أ/المعنى.md");
    expect(linkTargetPath("نص بلا رابط")).toBeNull();
  });
});
