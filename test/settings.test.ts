import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isExcluded, noteOptions, parseFolderList, readSettings } from "../src/plugin/settings";

describe("readSettings", () => {
  it("returns defaults for missing or broken data", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("x")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and resets only the broken ones", () => {
    const s = readSettings({ possible: "hidden", quotes: "nope", firstMentionOnly: "yes", language: "ar", excludedFolders: ["/قوالب/", 3, "قوالب"] });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, possible: "hidden", language: "ar", excludedFolders: ["قوالب"] });
  });
});

describe("excluded folders", () => {
  it("parses one folder per line and cleans slashes", () => {
    expect(parseFolderList(" قوالب/ \n\n./أرشيف//قديم\r\n/قوالب")).toEqual(["قوالب", "أرشيف/قديم"]);
  });

  it("matches the folder and its children only", () => {
    const f = ["قوالب", "أرشيف/قديم"];
    expect(isExcluded("قوالب/فصل.md", f)).toBe(true);
    expect(isExcluded("أرشيف/قديم/أ/ب.md", f)).toBe(true);
    expect(isExcluded("قوالب2/فصل.md", f)).toBe(false);
    expect(isExcluded("أرشيف/فصل.md", f)).toBe(false);
  });

  it("compares composed and decomposed hamza alike", () => {
    // «أ» مفككة: ا + همزة فوق (U+0654)
    expect(isExcluded("أرشيف/ب.md", parseFolderList("أرشيف"))).toBe(true);
  });
});

describe("note property wasl", () => {
  it("reads strings and lists, case-insensitively", () => {
    expect(noteOptions("exact")).toEqual({ exactOnly: true, indefinite: false });
    expect(noteOptions("Indefinite")).toEqual({ exactOnly: false, indefinite: true });
    expect(noteOptions(["indefinite"])).toEqual({ exactOnly: false, indefinite: true });
    expect(noteOptions(undefined)).toEqual({ exactOnly: false, indefinite: false });
    expect(noteOptions(5)).toEqual({ exactOnly: false, indefinite: false });
  });

  it("lets exact win when both are given", () => {
    expect(noteOptions("exact, indefinite")).toEqual({ exactOnly: true, indefinite: false });
  });
});
