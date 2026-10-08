import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Fixture = {
  id: string;
  kind: "match" | "context" | "vault";
  doc: string;
  target: { title: string; aliases: string[]; exactOnly: boolean; path: string };
  expect: { layer: 0 | 1 | 2 | null; surface?: string; acceptable?: (0 | 1 | 2 | null)[]; flags?: string[] };
  why: string;
  studyRef?: number;
};

const path = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = (name: string): Fixture[] => JSON.parse(readFileSync(path(name), "utf8"));
const dev = load("dev.json");
const heldout = load("heldout.json");

describe("fixtures", () => {
  it("ids are unique across both sets", () => {
    const ids = [...dev, ...heldout].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dev covers the study examples 1 to 31 exactly once", () => {
    expect(dev.map((f) => f.studyRef).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("sets are split by title, so tuning on dev cannot leak into held-out", () => {
    const names = (set: Fixture[]) => new Set(set.flatMap((f) => [f.target.title, ...f.target.aliases]));
    const devNames = names(dev);
    expect([...names(heldout)].filter((n) => devNames.has(n))).toEqual([]);
  });

  it.each([...dev, ...heldout])("$id is well formed", (f) => {
    expect(["match", "context", "vault"]).toContain(f.kind);
    expect([0, 1, 2, null]).toContain(f.expect.layer);
    expect(f.why.length).toBeGreaterThan(0);
    if (f.expect.layer === null) {
      expect(f.expect.surface).toBeUndefined();
    } else {
      expect(f.expect.surface).toBeDefined();
      expect(f.doc).toContain(f.expect.surface);
    }
    for (const a of f.expect.acceptable ?? []) expect([0, 1, 2, null]).toContain(a);
  });

  it("held-out set is locked (changes need a decision record)", () => {
    const hash = createHash("sha256").update(readFileSync(path("heldout.json"))).digest("hex");
    expect(hash).toBe(readFileSync(path("heldout.sha256"), "utf8").trim());
  });
});
