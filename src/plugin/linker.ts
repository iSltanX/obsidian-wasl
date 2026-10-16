import { getLinkpath, MarkdownView, type App, type Editor, type TFile } from "obsidian";
import type { Found } from "./context";
import { ensureAlias, escapeForTable, fullPathLink, linkFormat, linkTargetPath } from "./link";
import { revertLink, type LinkRecord } from "./undo";
import { applyLink, locatorOf, type LocateFailure } from "./write";

/**
 * توليد الرابط داخل Obsidian: `generateMarkdownLink` يتبع إعداد المستخدم (ويكي أو Markdown، والمسار
 * المختصر) ويمرَّر إليه المقطع الأصلي حرفيًا نصًا ظاهرًا (القرار ٤). ثم يُتحقق أن الرابط يصل إلى الوجهة
 * نفسها؛ وإن لم يصل (ملاحظتان بالاسم نفسه ولم يميّزهما) يُكتب بالمسار الكامل. وفي الجدول يُهرَّب `|`.
 */
export function generateLink(app: App, target: TFile, sourcePath: string, surface: string, inTable: boolean): string {
  return inTable ? escapeForTable(plainLink(app, target, sourcePath, surface)) : plainLink(app, target, sourcePath, surface);
}

/** الرابط بلا تهريب الجدول؛ التهريب يقرره موضع الكتابة الفعلي (write.ts). */
export function plainLink(app: App, target: TFile, sourcePath: string, surface: string): string {
  const link = app.fileManager.generateMarkdownLink(target, sourcePath, undefined, surface);
  const path = linkTargetPath(link);
  const dest = path === null ? null : app.metadataCache.getFirstLinkpathDest(getLinkpath(path), sourcePath);
  return dest?.path === target.path ? ensureAlias(link, surface) : fullPathLink(linkFormat(link), target.path, surface);
}

export type WriteFailure = LocateFailure | "missing";

export type WriteOutcome =
  | { readonly ok: true; readonly start: number; readonly link: string; readonly viaEditor: boolean }
  | { readonly ok: false; readonly reason: WriteFailure };

/** محرر مفتوح على الملف في وضع المصدر، إن وُجد. ما يُكتب فيه يدخل سجل تراجعه (Ctrl+Z). */
export function sourceEditor(app: App, path: string): Editor | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source") return view.editor;
  }
  return null;
}

const CANCEL = new Error("wasl-cancel");

/**
 * يكتب الرابط مكان الموضع بعد التحقق (write.ts): في المحرر إن كان الملف مفتوحًا في وضع المصدر،
 * وإلا بـ`vault.process` ذريًّا. الامتناع داخل `process` يكون برمي إشارة، فلا يُكتب شيء
 * (جُرّب في Obsidian 1.14.4: الملف لم يتغيّر والربط التالي نجح). `link` بلا تهريب الجدول.
 */
export async function writeLink(app: App, sourcePath: string, m: Found, link: string): Promise<WriteOutcome> {
  const file = app.vault.getFileByPath(sourcePath);
  if (!file) return { ok: false, reason: "missing" };
  const loc = locatorOf(m.start, m.surface, m.snippet);
  const cache = app.metadataCache.getFileCache(file) ?? undefined;

  const editor = sourceEditor(app, sourcePath);
  if (editor) {
    const r = applyLink(editor.getValue(), loc, link, cache);
    if (!r.ok) return r;
    editor.transaction({ changes: [{ from: editor.offsetToPos(r.start), to: editor.offsetToPos(r.end), text: r.link }] });
    return { ok: true, start: r.start, link: r.link, viaEditor: true };
  }

  let outcome: WriteOutcome = { ok: false, reason: "changed" };
  try {
    await app.vault.process(file, (data) => {
      const r = applyLink(data, loc, link, cache);
      if (!r.ok) {
        outcome = r;
        throw CANCEL;
      }
      outcome = { ok: true, start: r.start, link: r.link, viaEditor: false };
      return r.text;
    });
  } catch (e) {
    if (e !== CANCEL) throw e;
  }
  return outcome;
}

export type UndoOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: "changed" | "ambiguous" | "missing" };

/** يتراجع عن ربط مسجّل بعد التحقق أن الرابط ما زال كما كُتب (undo.ts)؛ عبر المحرر إن كان الملف مفتوحًا. */
export async function undoLink(app: App, r: LinkRecord): Promise<UndoOutcome> {
  const file = app.vault.getFileByPath(r.path);
  if (!file) return { ok: false, reason: "missing" };
  const editor = sourceEditor(app, r.path);
  if (editor) {
    const v = revertLink(editor.getValue(), r);
    if (!v.ok) return v;
    editor.transaction({ changes: [{ from: editor.offsetToPos(v.start), to: editor.offsetToPos(v.end), text: r.surface }] });
    return { ok: true };
  }
  let outcome: UndoOutcome = { ok: false, reason: "changed" };
  try {
    await app.vault.process(file, (data) => {
      const v = revertLink(data, r);
      if (!v.ok) {
        outcome = v;
        throw CANCEL;
      }
      outcome = { ok: true };
      return v.text;
    });
  } catch (e) {
    if (e !== CANCEL) throw e;
  }
  return outcome;
}
