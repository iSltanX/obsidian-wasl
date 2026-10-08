import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// يحرس قرار الخطة: الكود آمن للجوال من اليوم الأول.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const files = tsFiles(SRC).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const NODE_MODULES = /from\s+["'](node:[^"']+|fs|path|os|crypto|child_process|electron|url|util|stream|buffer)["']/;

describe("mobile safety", () => {
  it.each(files)("$path: no regex lookbehind (iOS < 16.4)", ({ text }) => {
    expect(text).not.toMatch(/\(\?<[=!]/);
  });

  it.each(files)("$path: no Unicode property escapes", ({ text }) => {
    expect(text).not.toMatch(/\\[pP]\{/);
  });

  it.each(files)("$path: no Node or Electron imports", ({ text }) => {
    expect(text).not.toMatch(NODE_MODULES);
  });

  // WorkspaceSidedock غير معرّف في نسخة الجوال وWorkspaceMobileDrawer في نسخة الحاسوب؛ instanceof عليهما يرمي خطأ
  it.each(files)("$path: no instanceof on platform-specific workspace classes", ({ text }) => {
    expect(text).not.toMatch(/instanceof\s+Workspace(Sidedock|MobileDrawer|RibbonItem)/);
  });

  it.each(files.filter((f) => f.path.startsWith("src/core/")))(
    "$path: core stays independent of Obsidian",
    ({ text }) => {
      expect(text).not.toMatch(/from\s+["']obsidian["']/);
    },
  );
});
