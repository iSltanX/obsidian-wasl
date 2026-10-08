import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluate, type Fixture } from "./support/evaluate";

// مجموعة الضبط: النواة تُضبط عليها حتى تمرّ كلها (الخطوة ١.٥).
// المجموعتان المقفلتان تُقاسان مرة واحدة بـ scripts/core-metrics.mjs ولا تدخلان هنا.
const dev: Fixture[] = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/dev.json", import.meta.url)), "utf8"));

describe("مجموعة الضبط", () => {
  it.each(dev)("$id: $why", (f) => {
    const v = evaluate(f);
    expect(v.problems, `${f.id}: ${f.doc}`).toEqual([]);
  });
});
