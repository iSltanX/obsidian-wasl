import { getLinkpath, parseFrontMatterAliases, type App, type TFile } from "obsidian";
import type { NoteInput } from "../core/index";
import type { NoteRef, ScanHost } from "./scan";
import { isExcluded, noteOptions, type WaslSettings } from "./settings";

/** العنوان والأسماء البديلة وخيارا `wasl` لملاحظة. */
export function noteInput(app: App, file: TFile): NoteInput {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return { path: file.path, title: file.basename, aliases: parseFrontMatterAliases(fm) ?? [], ...noteOptions(fm?.["wasl"]) };
}

/** العنوان والأسماء البديلة لملاحظة، للالتباس بين الملاحظات. */
export function noteRef(app: App, f: TFile): NoteRef {
  const aliases = parseFrontMatterAliases(app.metadataCache.getFileCache(f)?.frontmatter);
  return aliases?.length ? { path: f.path, title: f.basename, aliases } : { path: f.path, title: f.basename };
}

/** كل الملاحظات بعناوينها وأسمائها البديلة، ومنها المستثناة: الالتباس يخص الخزينة كلها. */
export function noteRefs(app: App): NoteRef[] {
  return app.vault.getMarkdownFiles().map((f) => noteRef(app, f));
}

/** الوصول إلى الخزينة للمسح: قراءة للعرض (`cachedRead`) وبيانات Obsidian لكل ملف. */
export function vaultHost(app: App, settings: () => WaslSettings): ScanHost {
  const { vault, metadataCache } = app;
  return {
    sources: () =>
      vault
        .getMarkdownFiles()
        .filter((f) => !isExcluded(f.path, settings().excludedFolders))
        .map((f) => ({ path: f.path, mtime: f.stat.mtime })),
    read: (path) => {
      const f = vault.getFileByPath(path);
      return f ? vault.cachedRead(f) : Promise.resolve(null);
    },
    metadata: (path) => {
      const f = vault.getFileByPath(path);
      return (f && metadataCache.getFileCache(f)) ?? undefined;
    },
    // كما يحلّ Obsidian الرابط نفسه: الأقرب من المصدر ثم أقصر مسار؛ فالحكم بالملف لا بالاسم
    resolveLink: (target, sourcePath) => metadataCache.getFirstLinkpathDest(getLinkpath(target), sourcePath)?.path ?? null,
  };
}
