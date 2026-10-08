import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Fixture = {
  id: string;
  kind: "match" | "context" | "vault";
  doc: string;
  target: { title: string; aliases: string[]; exactOnly: boolean; indefinite?: boolean; path: string };
  expect: { layer: 0 | 1 | 2 | null; surface?: string; acceptable?: (0 | 1 | 2 | null)[]; flags?: string[] };
  why: string;
  studyRef?: number;
  origin?: string;
};

const path = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = (name: string): Fixture[] => JSON.parse(readFileSync(path(name), "utf8"));
const dev = load("dev.json");
const heldout = load("heldout.json");
const novelStyle = load("heldout-novel-style.json");
const all = [...dev, ...heldout, ...novelStyle];

describe("fixtures", () => {
  it("ids are unique across all sets", () => {
    const ids = all.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dev covers the study examples 1 to 31 exactly once", () => {
    const refs = dev.flatMap((f) => (f.studyRef === undefined ? [] : [f.studyRef])).sort((a, b) => a - b);
    expect(refs).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("sets are split by title, so tuning on dev cannot leak into held-out", () => {
    const names = (set: Fixture[]) => new Set(set.flatMap((f) => [f.target.title, ...f.target.aliases]));
    const devNames = names(dev);
    const heldoutNames = names(heldout);
    expect([...heldoutNames].filter((n) => devNames.has(n))).toEqual([]);
    expect([...names(novelStyle)].filter((n) => devNames.has(n) || heldoutNames.has(n))).toEqual([]);
  });

  it.each(all)("$id is well formed", (f) => {
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
    if (f.target.indefinite !== undefined) expect(typeof f.target.indefinite).toBe("boolean");
  });

  it.each(["heldout", "heldout-novel-style"])("%s set is locked (changes need a decision record)", (name) => {
    const hash = createHash("sha256").update(readFileSync(path(`${name}.json`))).digest("hex");
    expect(hash).toBe(readFileSync(path(`${name}.sha256`), "utf8").trim());
  });
});
