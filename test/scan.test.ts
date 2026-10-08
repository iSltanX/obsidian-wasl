import { describe, expect, it } from "vitest";
import { makeTarget, ResultCache, Scan, type ScanHost, type SourceRef } from "../src/plugin/scan";

function host(files: Record<string, string>, mtimes: Record<string, number> = {}, fail: string[] = []) {
  const reads: string[] = [];
  const h: ScanHost = {
    sources: (): SourceRef[] => Object.keys(files).map((path) => ({ path, mtime: mtimes[path] ?? 1 })),
    read: async (path) => {
      reads.push(path);
      if (fail.includes(path)) throw new Error("unreadable");
      return files[path] as string;
    },
    metadata: () => undefined,
  };
  return { h, reads };
}

const target = makeTarget({ path: "الكتابة.md", title: "الكتابة" }, [
  { path: "الكتابة.md", title: "الكتابة" },
  { path: "أ.md", title: "أ" },
]);
const instant = { pause: async () => {}, budgetMs: 0 };

describe("makeTarget", () => {
  it("changes its signature with names and options", () => {
    const a = makeTarget({ path: "x.md", title: "الكتابة" }, []);
    const b = makeTarget({ path: "x.md", title: "الكتابة", aliases: ["writing"] }, []);
    const c = makeTarget({ path: "x.md", title: "الكتابة", indefinite: true }, []);
    expect(new Set([a.sig, b.sig, c.sig]).size).toBe(3);
  });

  it("lists other notes with the same title", () => {
    const t = makeTarget({ path: "أ/المعنى.md", title: "المعنى" }, [
      { path: "أ/المعنى.md", title: "المعنى" },
      { path: "ب/المعنى.md", title: "المعنى" },
      { path: "ج.md", title: "ج" },
    ]);
    expect(t.sameTitle).toEqual(["ب/المعنى.md"]);
  });
});

describe("Scan", () => {
  it("finds mentions with context and skips the target itself", async () => {
    const { h, reads } = host({ "الكتابة.md": "الكتابة", "أ.md": "سطر\nثم وبالكتابةِ نجا" });
    const scan = new Scan(target, h, new ResultCache(), instant);
    expect(await scan.run()).toBe("done");
    expect(reads).toEqual(["أ.md"]);
    const items = scan.results.get("أ.md")?.items ?? [];
    expect(items.map((m) => [m.surface, m.layer, m.line])).toEqual([["وبالكتابةِ", 1, 1]]);
    expect(scan.done).toBe(1);
    expect(scan.total).toBe(1);
  });

  it("reuses cached results until the file changes", async () => {
    const files = { "أ.md": "الكتابة", "ب.md": "لا شيء" };
    const cache = new ResultCache();
    const first = host(files);
    await new Scan(target, first.h, cache, instant).run();
    expect(first.reads).toEqual(["أ.md", "ب.md"]);
    const second = host(files, { "ب.md": 2 });
    const scan = new Scan(target, second.h, cache, instant);
    await scan.run();
    expect(second.reads).toEqual(["ب.md"]);
    expect(scan.results.get("أ.md")?.items.length).toBe(1);
  });

  it("stops between batches and keeps partial results", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`${i}.md`] = "الكتابة";
    const { h, reads } = host(files);
    let progress = 0;
    const scan = new Scan(target, h, new ResultCache(), { budgetMs: 0, pause: async () => {} });
    const state = await scan.run((s) => {
      progress++;
      if (s.done === 3) s.stop();
    });
    expect(state).toBe("stopped");
    expect(reads.length).toBe(3);
    expect(scan.results.size).toBe(3);
    expect(progress).toBe(3);
  });

  it("pauses only after the time budget is spent", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`${i}.md`] = "نص";
    let t = 0;
    let pauses = 0;
    const scan = new Scan(target, host(files).h, new ResultCache(), {
      budgetMs: 10,
      now: () => (t += 4),
      pause: async () => {
        pauses++;
      },
    });
    await scan.run();
    expect(pauses).toBe(2);
  });

  it("counts unreadable files and carries on", async () => {
    const { h } = host({ "أ.md": "الكتابة", "ب.md": "الكتابة" }, {}, ["أ.md"]);
    const warn = console.warn;
    console.warn = () => {};
    const scan = new Scan(target, h, new ResultCache(), instant);
    expect(await scan.run()).toBe("done");
    expect(scan.failed).toBe(1);
    expect([...scan.results.keys()]).toEqual(["ب.md"]);
    console.warn = warn;
  });
});

describe("ResultCache", () => {
  const r = (path: string, mtime = 1) => ({ path, mtime, items: [] });

  it("keeps only the most recent targets", () => {
    const cache = new ResultCache(2);
    cache.set("a", r("x.md"));
    cache.set("b", r("x.md"));
    cache.set("a", r("y.md")); // a صار الأحدث
    cache.set("c", r("x.md"));
    expect(cache.get("b", "x.md", 1)).toBeUndefined();
    expect(cache.get("a", "x.md", 1)).toBeDefined();
    expect(cache.get("c", "x.md", 1)).toBeDefined();
  });

  it("moves results on rename and forgets deleted files", () => {
    const cache = new ResultCache();
    cache.set("a", r("old.md"));
    cache.rename("old.md", "new.md");
    expect(cache.get("a", "old.md", 1)).toBeUndefined();
    expect(cache.get("a", "new.md", 1)?.path).toBe("new.md");
    cache.drop("new.md");
    expect(cache.get("a", "new.md", 1)).toBeUndefined();
  });
});

describe("Scan order and failure", () => {
  it("reads files in natural path order", async () => {
    const { h, reads } = host({ "فصل 10.md": "", "فصل 2.md": "", "أ.md": "" });
    await new Scan(target, h, new ResultCache(), instant).run();
    expect(reads).toEqual(["أ.md", "فصل 2.md", "فصل 10.md"]);
  });

  it("reports a failed scan when the vault listing throws", async () => {
    const h: ScanHost = {
      sources: () => {
        throw new Error("boom");
      },
      read: async () => "",
      metadata: () => undefined,
    };
    const errors = console.error;
    console.error = () => {};
    const state = await new Scan(target, h, new ResultCache(), instant).run();
    console.error = errors;
    expect(state).toBe("failed");
  });
});

describe("Scan measurement", () => {
  it("separates busy time from pauses and counts characters read", async () => {
    let t = 0;
    const files: Record<string, string> = { "أ.md": "الكتابة", "ب.md": "نص", "ج.md": "نص آخر" };
    const scan = new Scan(target, host(files).h, new ResultCache(), {
      budgetMs: 5,
      now: () => (t += 3),
      pause: async () => {
        t += 100;
      },
    });
    await scan.run();
    expect(scan.chars).toBe(7 + 2 + 6);
    expect(scan.wallMs).toBeGreaterThan(100);
    expect(scan.busyMs).toBeLessThan(scan.wallMs - 100);
    expect(scan.maxBatchMs).toBeGreaterThanOrEqual(5);
    expect(scan.maxBatchMs).toBeLessThanOrEqual(scan.busyMs);
  });
});
