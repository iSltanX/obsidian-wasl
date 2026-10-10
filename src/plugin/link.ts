/**
 * نص الرابط ومعاينته. نقي بلا `obsidian`: الرابط نفسه يولّده `fileManager.generateMarkdownLink` في
 * التطبيق (فيتبع إعداد المستخدم: wikilink أو Markdown، والمسار المختصر)، وهنا ما حوله:
 * تهريب `|` داخل الجداول (القرار ٢٩)، ورابط يدوي بالمسار الكامل حين لا يصل المولَّد إلى الوجهة،
 * وبناء سطر «بعد» في المعاينة (docs/ui.md، البند ٧).
 */

import type { Snippet } from "./context";

export type LinkFormat = "wiki" | "markdown";

/** صيغة رابط ولّده Obsidian: `[[…]]` أو `![[…]]` ويكي، وغير ذلك Markdown. */
export function linkFormat(link: string): LinkFormat {
  return /^!?\[\[/.test(link) ? "wiki" : "markdown";
}

/**
 * داخل الجدول يكسر `|` الخلية، فيُكتب `\|`. يخص الويكي وحده: رابط Markdown لا يحمل `|`،
 * والنص الظاهر كلمة واحدة بلا رموز. ما هُرّب من قبل لا يُهرَّب ثانية.
 */
export function escapeForTable(link: string): string {
  if (linkFormat(link) !== "wiki") return link;
  return link.replace(/\\?\|/g, "\\|");
}

/** مسار ملاحظة بلا امتداد `.md`، للويكي. */
function withoutMd(path: string): string {
  return path.replace(/\.md$/i, "");
}

/**
 * رابط يدوي بالمسار الكامل من جذر الخزينة، للحالة النادرة التي لا يصل فيها الرابط المولَّد إلى الوجهة
 * (ملاحظتان بالاسم نفسه ولم يميّزهما Obsidian). يُكتب بصيغة الرابط المولَّد نفسها.
 */
export function fullPathLink(format: LinkFormat, path: string, surface: string): string {
  if (format === "wiki") return `[[${withoutMd(path)}|${surface}]]`;
  // Obsidian يبقي الحروف العربية في مسارات Markdown ويهرّب المسافات وحدها؛ والأقواس تُهرَّب كي لا تُغلق الرابط
  const encoded = path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${surface}](${encoded})`;
}

/**
 * النص الظاهر يُكتب دائمًا، حتى حين يساوي اسم الملف (قرار ١٠ أكتوبر ٢٠٢٦ بعد ت٤): Obsidian يُسقطه
 * عندها فيكتب `[[الهدف]]`، وإعادة تسمية الملاحظة لاحقًا تغيّر الكلمة داخل الجملة. `[[الهدف|الهدف]]`
 * يبقي الكلمة كما كُتبت. رابط Markdown يحمل نصه الظاهر أصلًا.
 */
export function ensureAlias(link: string, surface: string): string {
  if (linkFormat(link) !== "wiki") return link;
  const m = /^(!?\[\[)([^\]|]*)\]\]$/.exec(link);
  return m ? `${m[1]}${m[2]}|${surface}]]` : link;
}

/** سطر «بعد» في المعاينة: السياق نفسه والرابط مكان المقطع. */
export interface AfterPreview {
  readonly text: string;
  readonly linkStart: number;
  readonly linkEnd: number;
}

export function previewAfter(snippet: Snippet, link: string): AfterPreview {
  const before = snippet.text.slice(0, snippet.matchStart);
  const after = snippet.text.slice(snippet.matchEnd);
  return { text: before + link + after, linkStart: before.length, linkEnd: before.length + link.length };
}

/**
 * مسار الوجهة من رابط مولَّد: ما قبل `|` و`#` و`^` في الويكي، وما بين القوسين في Markdown مفكوكًا.
 * `null` إن لم يُفهم الرابط.
 */
export function linkTargetPath(link: string): string | null {
  const wiki = /^!?\[\[([^\]|#^]+)/.exec(link);
  if (wiki) return (wiki[1] as string).trim();
  const md = /^!?\[[^\]]*\]\(<?([^)>#]+)/.exec(link);
  if (!md) return null;
  const raw = (md[1] as string).trim();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
