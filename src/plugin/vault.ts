import { parseFrontMatterAliases, type App, type TFile } from "obsidian";
import type { NoteInput } from "../core/index";
import type { NoteRef, ScanHost } from "./scan";
import { isExcluded, noteOptions, type WaslSettings } from "./settings";

/** العنوان والأسماء البديلة وخيارا `wasl` لملاحظة. */
export function noteInput(app: App, file: TFile): NoteInput {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  return { path: file.path, title: file.basename, aliases: parseFrontMatterAliases(fm) ?? [], ...noteOptions(fm?.["wasl"]) };
}

/** كل الملاحظات بعناوينها، ومنها المستثناة: الالتباس يخص الخزينة كلها. */
export function noteRefs(app: App): NoteRef[] {
  return app.vault.getMarkdownFiles().map((f) => ({ path: f.path, title: f.basename }));
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
  };
}
