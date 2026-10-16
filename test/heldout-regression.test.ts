import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluate, type Fixture } from "./support/evaluate";

// حارس انحدار لا ضبط: المجموعتان المقفلتان قيستا مرة (انظر `npm run metrics`) وسُجّلت أحكامهما هنا.
// هذا الاختبار يثبّت الأحكام المسجّلة كي لا يغيّرها إصلاح لاحق بصمت.
// أي تغيير هنا يستلزم إعادة القياس بـ `npm run metrics`.
const RECORDED_FAILURES: Record<string, string[]> = {
  heldout: [],
  "heldout-novel-style": ["n26"],
};

describe("المجموعتان المقفلتان: الأحكام المسجّلة لا تتغير", () => {
  it.each(Object.keys(RECORDED_FAILURES))("%s", (name) => {
    const set: Fixture[] = JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), "utf8"));
    const failing = set.map(evaluate).filter((v) => !v.ok).map((v) => v.id);
    expect(failing).toEqual(RECORDED_FAILURES[name]);
  });
});
