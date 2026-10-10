/**
 * من نتائج المسح إلى ما تعرضه اللوحة: الوسوم، والأقسام والمجموعات بحسب الإعدادات.
 * نقي بلا `obsidian`. العقد: docs/ui.md، البنود ٥ و٦ و٨.
 */

import type { Mention } from "../core/match";
import type { Found } from "./context";
import type { Key } from "./i18n";
import { comparePaths } from "./scan";
import type { WaslSettings } from "./settings";

export interface Tag {
  readonly key: Key;
  readonly detail?: string;
  /** فروق الفئة (أ) تُعرض باهتة: تشرح ولا تُقلق. */
  readonly minor: boolean;
}

const MAJOR: Partial<Record<Mention["reasons"][number]["code"], Key>> = {
  prefix: "tagPrefix",
  "initial-hamza": "tagHamza",
  indefinite: "tagIndefinite",
  definite: "tagDefinite",
  suffix: "tagSuffix",
  "short-core": "tagShortCore",
};

const MINOR: Partial<Record<Mention["reasons"][number]["code"], Key>> = {
  diacritics: "tagDiacritics",
  tatweel: "tagTatweel",
  invisible: "tagInvisible",
  "presentation-forms": "tagPresentation",
  digits: "tagDigits",
  "persian-letters": "tagPersian",
  case: "tagCase",
};

const FLAGS: Partial<Record<Mention["flags"][number], Key>> = {
  quote: "tagQuote",
  table: "tagTable",
  "already-linked": "tagLinked",
  unvocalized: "tagUnvocalized",
};

/** وسوم البطاقة بترتيب العقد: أسباب الطبقة، ثم الاسم البديل، ثم فروق الفئة (أ)، ثم الأعلام. */
export function tagsFor(m: Mention): Tag[] {
  const major: Tag[] = [];
  const minor: Tag[] = [];
  for (const r of m.reasons) {
    const mk = MAJOR[r.code];
    if (mk) major.push({ key: mk, detail: r.detail, minor: false });
    const nk = MINOR[r.code];
    // النواة تضيف «تشكيل» كلما شُكّل العنوان؛ مع «بلا تشكيل» يتناقضان
    if (nk && !(r.code === "diacritics" && m.flags.includes("unvocalized"))) minor.push({ key: nk, minor: true });
  }
  if (!major.length && m.layer === 0) major.unshift({ key: "tagExact", minor: false });
  if (m.isAlias) major.push({ key: "tagAlias", detail: m.name, minor: false });
  const flags: Tag[] = [];
  for (const f of m.flags) {
    const k = FLAGS[f];
    if (k) flags.push({ key: k, minor: false });
  }
  return [...major, ...minor, ...flags];
}

export interface Group {
  readonly path: string;
  readonly items: readonly Found[];
}

export interface Presented {
  /** الطبقتان ٠ و١. */
  readonly main: readonly Group[];
  /** الطبقة ٢؛ فارغ إن أُخفي بالإعداد. */
  readonly possible: readonly Group[];
  readonly mainCount: number;
  readonly possibleCount: number;
  /** عدد الملاحظات المصدر التي ظهر منها شيء. */
  readonly noteCount: number;
  /** ما أخفته الإعدادات (اقتباسات، محتمل، أول ذكر). */
  readonly hidden: number;
  /** ما تجاهله المستخدم. */
  readonly ignored: number;
}

export type DisplaySettings = Pick<WaslSettings, "possible" | "quotes" | "firstMentionOnly">;

/** سبب إخفاء موضع بعينه: رُبط للتو (حتى يُعاد مسح ملفه) أو تجاهله المستخدم. */
export type HideReason = "linked" | "ignored";

/** يرتب نتائج الملفات في قسمين ومجموعات حسب إعدادات العرض (البند ٥ والبند ٨ في العقد). */
export function present(files: Iterable<Group>, settings: DisplaySettings, hide?: (path: string, m: Found) => HideReason | undefined): Presented {
  const main: Group[] = [];
  const possible: Group[] = [];
  let hidden = 0;
  let ignored = 0;
  for (const file of files) {
    let items = file.items;
    if (!items.length) continue;
    if (hide) {
      const kept: Found[] = [];
      for (const m of items) {
        const why = hide(file.path, m);
        if (why === "ignored") ignored++;
        else if (!why) kept.push(m);
      }
      items = kept;
      if (!items.length) continue;
    }
    if (settings.quotes === "hidden") {
      const kept = items.filter((m) => !m.flags.includes("quote"));
      hidden += items.length - kept.length;
      items = kept;
    }
    if (settings.firstMentionOnly && items.some((m) => m.flags.includes("already-linked"))) {
      hidden += items.length;
      continue;
    }
    let sure = items.filter((m) => m.layer < 2);
    let maybe = items.filter((m) => m.layer === 2);
    if (settings.firstMentionOnly) {
      const before = sure.length + maybe.length;
      sure = sure.slice(0, 1);
      maybe = sure.length ? [] : maybe.slice(0, 1);
      hidden += before - sure.length - maybe.length;
    }
    if (settings.possible === "hidden") {
      hidden += maybe.length;
      maybe = [];
    }
    if (sure.length) main.push({ path: file.path, items: sure });
    if (maybe.length) possible.push({ path: file.path, items: maybe });
  }
  const byPath = (a: Group, b: Group): number => comparePaths(a.path, b.path);
  main.sort(byPath);
  possible.sort(byPath);
  const count = (groups: readonly Group[]): number => groups.reduce((n, g) => n + g.items.length, 0);
  const notes = new Set([...main, ...possible].map((g) => g.path));
  return { main, possible, mainCount: count(main), possibleCount: count(possible), noteCount: notes.size, hidden, ignored };
}

/** اسم الملف بلا مجلد ولا امتداد. */
export function basename(path: string): string {
  return (path.split("/").pop() as string).replace(/\.md$/i, "");
}

/** المجلد الأب، أو نص فارغ للجذر. */
export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** الأسماء المكررة بين المجموعات: تُعرض بمجلدها لتتميز. */
export function duplicateNames(groups: Iterable<Group>): Set<string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const g of groups) {
    const b = basename(g.path);
    const prev = seen.get(b);
    if (prev !== undefined && prev !== g.path) dup.add(b);
    seen.set(b, g.path);
  }
  return dup;
}

/** كم بطاقة تظهر من مجموعة قبل «اعرض المزيد»: خمس، أو الكل إن لم يبقَ بعدها إلا اثنتان. */
export function visibleCount(total: number, expanded: boolean, step = 5): number {
  if (expanded || total <= step + 2) return total;
  return step;
}
