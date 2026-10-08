import { apiVersion, Modal, Notice, Platform, type TFile } from "obsidian";
import type WaslPlugin from "./main";
import { makeTarget, ResultCache, Scan } from "./scan";
import { noteInput, noteRefs, vaultHost } from "./vault";
import { MentionsView, VIEW_TYPE } from "./view";

/**
 * قياس زمن البحث لملاحظة واحدة (ت٣): بحث أول بذاكرة فارغة، ثم ثانٍ من الذاكرة.
 * للقراءة فقط: النتيجة تُعرض في نافذة وتُنسخ، ولا تُكتب في ملف.
 */

interface Run {
  readonly wallMs: number;
  readonly busyMs: number;
  readonly maxBatchMs: number;
  readonly files: number;
  readonly chars: number;
  readonly failed: number;
  readonly sure: number;
  readonly possible: number;
}

interface Measurement {
  readonly indexMs: number;
  readonly cold: Run;
  readonly warm: Run;
  /** فرق الذاكرة بعد البحث الأول بالبايت؛ غير متاح خارج Chromium (iOS مثلًا). */
  readonly heapDelta?: number;
}

function heap(): number | undefined {
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
}

function device(): string {
  if (Platform.isIosApp) return Platform.isTablet ? "iPadOS" : "iOS";
  if (Platform.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android";
  if (Platform.isMacOS) return "macOS";
  if (Platform.isWin) return "Windows";
  if (Platform.isLinux) return "Linux";
  return "?";
}

async function measure(plugin: WaslPlugin, file: TFile): Promise<Measurement> {
  const app = plugin.app;
  const before = heap();
  const t0 = performance.now();
  const target = makeTarget(noteInput(app, file), noteRefs(app));
  const indexMs = performance.now() - t0;
  // ذاكرة مستقلة عن ذاكرة اللوحة، فالبحث الأول بارد فعلًا
  const cache = new ResultCache(1);
  const host = vaultHost(app, () => plugin.settings);
  const run = async (): Promise<Run> => {
    const scan = new Scan(target, host, cache, { now: () => performance.now() });
    await scan.run();
    let sure = 0;
    let possible = 0;
    for (const r of scan.results.values()) for (const m of r.items) m.layer === 2 ? possible++ : sure++;
    const { wallMs, busyMs, maxBatchMs, total: files, chars, failed } = scan;
    return { wallMs, busyMs, maxBatchMs, files, chars, failed, sure, possible };
  };
  const cold = await run();
  const after = heap();
  const warm = await run();
  return { indexMs, cold, warm, heapDelta: before !== undefined && after !== undefined ? after - before : undefined };
}

export async function showMeasurement(plugin: WaslPlugin, file: TFile): Promise<void> {
  const s = plugin.s;
  const notice = new Notice(s.t("measureRunning"), 0);
  let m: Measurement;
  try {
    m = await measure(plugin, file);
  } catch (e) {
    console.error("Wasl: measurement failed", e);
    new Notice(s.t("failed"));
    return;
  } finally {
    notice.hide();
  }
  const ms = (n: number): string => s.num(Math.round(n));
  const lines = [
    `Wasl ${plugin.manifest.version} · Obsidian ${apiVersion} · ${device()}`,
    s.t("measureTarget", { name: file.basename, notes: s.notes(m.cold.files) }),
    s.t("measureIndex", { ms: ms(m.indexMs) }),
    s.t("measureCold", { wall: ms(m.cold.wallMs), busy: ms(m.cold.busyMs), max: ms(m.cold.maxBatchMs) }),
    s.t("measureText", { chars: s.num(Math.round(m.cold.chars / 1000)) }),
    s.t("measureWarm", { wall: ms(m.warm.wallMs) }),
    s.t("measureMentions", { sure: m.cold.sure, possible: m.cold.possible }),
    m.heapDelta === undefined ? s.t("measureHeapNA") : s.t("measureHeap", { mb: s.num(Math.round(m.heapDelta / 1e5) / 10) }),
  ];
  const view = plugin.app.workspace
    .getLeavesOfType(VIEW_TYPE)
    .map((l) => l.view)
    .find((x): x is MentionsView => x instanceof MentionsView && x.targetPath === file.path);
  lines.push(view && view.lastRenderMs ? s.t("measureRender", { ms: ms(view.lastRenderMs) }) : s.t("measureRenderNA"));
  if (m.cold.failed) lines.push(s.t("readErrors", { notes: s.notes(m.cold.failed) }));
  new MeasureModal(plugin, lines).open();
}

class MeasureModal extends Modal {
  constructor(
    private readonly plugin: WaslPlugin,
    private readonly lines: readonly string[],
  ) {
    super(plugin.app);
  }

  override onOpen(): void {
    const s = this.plugin.s;
    this.modalEl.dir = s.lang === "ar" ? "rtl" : "ltr";
    this.setTitle(s.t("measureTitle"));
    const box = this.contentEl.createDiv({ cls: "wasl-measure" });
    for (const line of this.lines) box.createDiv({ text: line, attr: { dir: "auto" } });
    const copy = this.contentEl.createEl("button", { cls: "mod-cta", text: s.t("measureCopy") });
    copy.onclick = async () => {
      await navigator.clipboard.writeText(this.lines.join("\n"));
      new Notice(s.t("measureCopied"));
    };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
