import { getLinkpath, type App, type TFile } from "obsidian";
import { escapeForTable, fullPathLink, linkFormat, linkTargetPath } from "./link";

/**
 * توليد الرابط داخل Obsidian: `generateMarkdownLink` يتبع إعداد المستخدم (ويكي أو Markdown، والمسار
 * المختصر) ويمرَّر إليه المقطع الأصلي حرفيًا نصًا ظاهرًا (القرار ٤). ثم يُتحقق أن الرابط يصل إلى الوجهة
 * نفسها؛ وإن لم يصل (ملاحظتان بالاسم نفسه ولم يميّزهما) يُكتب بالمسار الكامل. وفي الجدول يُهرَّب `|`.
 */
export function generateLink(app: App, target: TFile, sourcePath: string, surface: string, inTable: boolean): string {
  let link = app.fileManager.generateMarkdownLink(target, sourcePath, undefined, surface);
  const path = linkTargetPath(link);
  const dest = path === null ? null : app.metadataCache.getFirstLinkpathDest(getLinkpath(path), sourcePath);
  if (dest?.path !== target.path) link = fullPathLink(linkFormat(link), target.path, surface);
  return inTable ? escapeForTable(link) : link;
}
