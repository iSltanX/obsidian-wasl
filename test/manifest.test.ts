import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8"));

const manifest = read("manifest.json");
const versions = read("versions.json");
const pkg = read("package.json");

describe("release metadata", () => {
  it("package and manifest versions match", () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it("versions.json records the current version", () => {
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });

  it("follows directory naming rules", () => {
    expect(manifest.id).toBe("wasl");
    expect(manifest.id).not.toMatch(/obsidian/i);
    expect(manifest.description).not.toMatch(/obsidian/i);
    expect(manifest.description.endsWith(".")).toBe(true);
    expect(manifest.description.length).toBeLessThanOrEqual(250);
  });
});
