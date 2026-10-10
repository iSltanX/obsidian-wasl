import {
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  Platform,
  setIcon,
  TFile,
  type TAbstractFile,
  type WorkspaceLeaf,
} from "obsidian";
import type { Found } from "./context";
import type WaslPlugin from "./main";
import { nameKey } from "../core/index";
import { basename, duplicateNames, folderOf, present, tagsFor, visibleCount, type Group, type HideReason, type Presented } from "./present";
import { fingerprint, formKey } from "./ignore";
import { previewAfter } from "./link";
import { generateLink, writeLink, type WriteFailure } from "./linker";
import { showMeasurement } from "./measure";
import { makeTarget, Scan, type Target } from "./scan";
import { isExcluded } from "./settings";
import { noteInput, noteRefs, vaultHost } from "./vault";

export const VIEW_TYPE = "wasl-mentions";

/** مهلة قبل البحث عند تبديل الملاحظة، كي لا يبدأ بحث لكل ملاحظة يُقفز فوقها. */
const START_DELAY = 300;
/** أقصى معدل لإعادة الرسم أثناء البحث. */
const RENDER_EVERY = 250;
/** أقصى معدل لتحديث منطقة قارئ الشاشة. */
const ANNOUNCE_EVERY = 2000;
/** عدد المجموعات في القسم قبل «اعرض الباقي». */
const GROUP_STEP = 50;
/** أقصى تأجيل للبناء والمؤشر مضغوط: رفعه خارج النافذة قد لا يصل. */
const HOLD_MAX = 1500;

type Section = "main" | "possible";
type Mode = "none" | "unsearchable" | "running" | "idle" | "stopped" | "done" | "failed";

/** مفتاح ثابت لعنصر قابل للتركيز، يُستعاد به التركيز بعد البناء. */
const key = (...parts: (string | number)[]): string => JSON.stringify(parts);

/**
 * اللوحة الجانبية: مواضع الملاحظة النشطة غير المربوطة في الملاحظات الأخرى (docs/ui.md).
 * للقراءة فقط في المرحلة ٢: «افتح» وحده فعّال.
 */
export class MentionsView extends ItemView {
  private target: Target | null = null;
  private scan: Scan | null = null;
  /** آخر ملف نشط رأته اللوحة؛ تتبع تغيّره لا كل حدث تنقل (البند ٢). */
  private lastActive: string | null = null;
  /** بحث مطلوب ينتظر ظهور اللوحة أو انتهاء المهلة. */
  private wantScan = false;
  /** أُوقف البحث لأن اللوحة اختفت، لا بطلب المستخدم. */
  private pausedHidden = false;
  private startTimer: number | null = null;
  private renderTimer: number | null = null;
  private lastRender = 0;
  private lastAnnounce = 0;
  private announced = "";
  private closed = false;
  /** ظهور اللوحة نفسها: فتح الدرج على الجوال لا يطلق حدثًا من أحداث مساحة العمل. */
  private observer: IntersectionObserver | null = null;
  /** رقم كل بحث، فيتميّز بحثان للهدف نفسه في مفتاح القائمة. */
  private scanSerial = 0;
  /** يزيد مع كل فعل عرض (طي، «اعرض الباقي»، «زرتَها») فيُعاد بناء القائمة. */
  private uiVersion = 0;
  private headKey = "";
  private bodyKey = "";
  /** وقت ضغط المؤشر داخل اللوحة، أو صفر. */
  private pointerDownAt = 0;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  /** زمن آخر رسم كامل للوحة وهدفه؛ يقرؤه أمر القياس (ت٣). */
  lastRenderMs = 0;
  get targetPath(): string | null {
    return this.target?.note.path ?? null;
  }

  // حالة العرض: تبقى عند إعادة الرسم وتُنسى عند تغيّر الهدف
  private sectionOpen: Record<Section, boolean> = { main: true, possible: false };
  private collapsed = new Set<string>();
  private expanded = new Set<string>();
  private groupLimit: Record<Section, number> = { main: GROUP_STEP, possible: GROUP_STEP };
  private visited = new Set<string>();
  /** البطاقة الموسّعة بمعاينة الربط (مصدر + موضع)، أو لا شيء. */
  private preview: string | null = null;
  /** مواضع رُبطت للتو؛ تختفي فورًا ريثما يُعاد مسح ملفها. */
  private linked = new Set<string>();
  /** ربط جارٍ: لا يُقبل تأكيد ثانٍ قبل انتهائه. */
  private linking = false;
  /** عرض المواضع المتجاهَلة في مكانها بوسمها، لإلغاء تجاهلها. */
  private showIgnored = false;

  // أسماء لا تتعارض مع أعضاء View الداخلية غير الموثقة (open، headerEl): تعارضها يكسر فتح اللوحة
  private topEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private liveEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: WaslPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.s.t("viewTitle");
  }

  override getIcon(): string {
    return "link";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("wasl-view");
    this.topEl = this.contentEl.createDiv("wasl-header");
    this.bodyEl = this.contentEl.createDiv("wasl-body");
    this.liveEl = this.contentEl.createDiv({ cls: "wasl-sr-only", attr: { role: "status", "aria-live": "polite" } });

    const ws = this.app.workspace;
    this.registerEvent(ws.on("file-open", () => this.followActive()));
    this.registerEvent(
      ws.on("active-leaf-change", () => {
        this.followActive();
        this.wake();
      }),
    );
    this.registerEvent(ws.on("layout-change", () => this.wake()));
    this.registerEvent(ws.on("resize", () => this.wake()));
    this.registerDomEvent(this.contentEl, "pointerdown", () => (this.pointerDownAt = Date.now()));
    const release = (): void => {
      if (!this.pointerDownAt) return;
      this.pointerDownAt = 0;
      this.requestRender();
    };
    this.registerDomEvent(this.contentEl.ownerDocument, "pointerup", release);
    this.registerDomEvent(this.contentEl.ownerDocument, "pointercancel", release);
    this.observer = new IntersectionObserver(() => this.wake());
    this.observer.observe(this.contentEl);
    // أحداث الخزينة بعد جاهزية التخطيط: قبلها يُطلق «create» لكل ملف عند الفتح
    ws.onLayoutReady(() => {
      if (this.closed) return;
      this.registerEvent(this.app.metadataCache.on("changed", (file) => this.fileChanged(file)));
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.fileRenamed(file, oldPath)));
      this.registerEvent(this.app.vault.on("delete", (file) => this.fileDeleted(file)));
      this.registerEvent(this.app.vault.on("create", (file) => this.fileCreated(file)));
      this.followActive(true);
    });
    this.render();
  }

  override async onClose(): Promise<void> {
    this.closed = true;
    this.observer?.disconnect();
    this.scan?.stop();
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  override onResize(): void {
    this.wake();
  }

  /** تراجُع عن ربط: يُحدَّث الملف وحده ويعود موضعه إلى القائمة. */
  linkUndone(file: TFile | null): void {
    if (file) {
      for (const k of [...this.linked]) if (k.startsWith(file.path + "\u0000")) this.linked.delete(k);
      this.refreshFile(file);
    }
    this.render();
  }

  /** الإعدادات تغيّرت: `rescan` حين يتغيّر ما يُبحث فيه، وإلا فإعادة رسم. */
  settingsChanged(rescan: boolean): void {
    if (rescan && this.target) this.queueScan(0);
    this.render();
  }

  // ───── المتابعة والبحث ─────

  private followActive(initial = false): void {
    const file = this.app.workspace.getActiveFile();
    const path = file?.path ?? null;
    if (!initial && path === this.lastActive) return;
    this.lastActive = path;
    // لوحة رسم أو PDF لا تغيّر الهدف ولا تُفرغ القائمة
    if (!file || file.extension !== "md") {
      this.requestRender();
      return;
    }
    this.setTarget(file);
  }

  /** يحسب الهدف من الملف؛ يعيد `true` إن تغيّرت البصمة وبدأ بحث جديد. */
  private setTarget(file: TFile, opts: { now?: boolean } = {}): boolean {
    const next = makeTarget(noteInput(this.app, file), noteRefs(this.app));
    const prev = this.target;
    const samePath = prev?.note.path === file.path;
    if (samePath && prev?.sig === next.sig) {
      // «المفتوحة الآن» وتنبيه الالتباس قد تغيّرا ولو بقيت البصمة
      this.target = next;
      this.requestRender();
      return false;
    }
    if (!samePath) this.resetViewState();
    this.target = next;
    this.scan?.stop();
    this.scan = null;
    this.pausedHidden = false;
    if (next.index.size) this.queueScan(samePath || opts.now ? 0 : START_DELAY);
    this.render();
    return true;
  }

  private resetViewState(): void {
    this.sectionOpen = { main: true, possible: false };
    this.collapsed.clear();
    this.expanded.clear();
    this.groupLimit = { main: GROUP_STEP, possible: GROUP_STEP };
    this.visited.clear();
    this.preview = null;
    this.linked.clear();
    this.showIgnored = false;
    this.uiVersion++;
    this.bodyEl.scrollTop = 0;
    this.contentEl.scrollTop = 0;
  }

  private queueScan(delay: number): void {
    if (this.startTimer !== null) window.clearTimeout(this.startTimer);
    this.wantScan = true;
    this.startTimer = window.setTimeout(() => {
      this.startTimer = null;
      this.wake();
    }, delay);
  }

  /** يبدأ البحث المنتظر إن ظهرت اللوحة. */
  private wake(): void {
    if (this.closed || !this.wantScan || this.startTimer !== null || !this.target) return;
    if (!this.isVisible()) return;
    this.wantScan = false;
    void this.runScan();
  }

  private isVisible(): boolean {
    if (this.closed || !this.containerEl.isShown()) return false;
    // مقارنة مباشرة لا instanceof: WorkspaceSidedock غير معرّف على الجوال، وWorkspaceMobileDrawer على الحاسوب
    const { leftSplit, rightSplit } = this.app.workspace;
    const root = this.leaf.getRoot();
    if (root === leftSplit) return !leftSplit.collapsed;
    if (root === rightSplit) return !rightSplit.collapsed;
    return true;
  }

  private async runScan(): Promise<void> {
    const target = this.target;
    if (!target || !target.index.size) return;
    this.scan?.stop();
    const scan = new Scan(target, vaultHost(this.app, () => this.plugin.settings), this.plugin.cache);
    this.scan = scan;
    this.scanSerial++;
    this.pausedHidden = false;
    // لا رسم فوري: الملفات المحفوظة في الذاكرة تُقرأ في الدفعة الأولى، فلا تومض القائمة فارغة
    this.requestRender();
    await scan.run((s) => {
      if (this.scan !== s) {
        s.stop();
        return;
      }
      if (s.state === "running" && !this.isVisible()) {
        // اللوحة اختفت (الدرج أُغلق مثلًا): يتوقف البحث ويُستأنف فيما بقي حين تظهر
        s.stop();
        this.pausedHidden = true;
        this.wantScan = true;
      }
      this.requestRender();
    });
    if (this.scan === scan) this.render();
  }

  private stopByUser(): void {
    this.scan?.stop();
    this.wantScan = false;
    if (this.startTimer !== null) {
      window.clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.render();
  }

  private rescan(): void {
    if (!this.target) return;
    this.plugin.cache.clear(this.target.sig);
    this.wantScan = false;
    void this.runScan();
  }

  // ───── تغيّرات الخزينة ─────

  /** يعيد حساب الهدف بعد تغيّر قد يمس اسمه أو التباسه؛ `true` إن بدأ بحث جديد. */
  private recheckTarget(): boolean {
    const path = this.target?.note.path;
    const file = path ? this.app.vault.getFileByPath(path) : null;
    return file ? this.setTarget(file, { now: true }) : false;
  }

  /** يحدّث نتيجة ملف واحد دون إعادة البحث كله. */
  private refreshFile(file: TFile): void {
    const scan = this.scan;
    if (!scan || !this.target || scan.target.sig !== this.target.sig) return;
    if (isExcluded(file.path, this.plugin.settings.excludedFolders)) {
      scan.forget(file.path);
      this.requestRender();
      return;
    }
    if (!this.isVisible()) {
      // يُقرأ عند الظهور: وقت التعديل تغيّر فلن تُستعمل النتيجة المحفوظة
      this.wantScan = true;
      return;
    }
    void scan.scanFile({ path: file.path, mtime: file.stat.mtime }).then(() => this.requestRender());
  }

  private fileChanged(file: TFile): void {
    if (!this.target || file.extension !== "md") return;
    if (file.path === this.target.note.path) {
      this.recheckTarget(); // الأسماء البديلة أو خاصية wasl
      return;
    }
    this.refreshFile(file);
  }

  /**
   * هل يمس الملف التباس عنوان الهدف؟ هو الشيء الوحيد في الهدف الذي يعتمد على الملاحظات الأخرى.
   * بدون هذا الفحص كانت عملية جماعية (مزامنة، نقل مجلد) تعيد بناء الفهرس كله مع كل ملف.
   */
  private touchesTitle(...paths: string[]): boolean {
    const t = this.target;
    if (!t) return false;
    const titleKey = nameKey(t.note.title);
    return paths.some((p) => p.toLowerCase().endsWith(".md") && nameKey(basename(p)) === titleKey);
  }

  private fileRenamed(file: TAbstractFile, oldPath: string): void {
    if (this.lastActive === oldPath) this.lastActive = file.path;
    const t = this.target;
    if (!(file instanceof TFile)) {
      // مجلد: Obsidian يطلق «rename» لكل ملف فيه بعده، فتنتقل النتائج واحدة واحدة. يبقى الهدف إن كان فيه،
      // وبحث جديد احتياطًا إن لم تصل أحداث الملفات (الجوال لم يُتحقق منه): ما نُقل في الذاكرة لا يُقرأ ثانية
      if (!t) return;
      const moved = t.note.path.startsWith(oldPath + "/") ? this.app.vault.getFileByPath(file.path + t.note.path.slice(oldPath.length)) : null;
      if (moved) this.setTarget(moved, { now: true });
      else this.queueScan(0);
      return;
    }
    if (file.extension !== "md") return;
    this.plugin.cache.rename(oldPath, file.path);
    if (!t) return;
    if (t.note.path === oldPath) {
      this.setTarget(file, { now: true });
      return;
    }
    if (this.touchesTitle(oldPath, file.path) && this.recheckTarget()) return;
    const scan = this.scan;
    if (!scan) return;
    if (isExcluded(file.path, this.plugin.settings.excludedFolders)) {
      scan.forget(oldPath);
      this.requestRender();
    } else if (scan.results.has(oldPath)) {
      scan.move(oldPath, file.path);
      this.requestRender();
    } else {
      scan.forget(oldPath);
      this.refreshFile(file);
    }
  }

  private fileDeleted(file: TAbstractFile): void {
    const t = this.target;
    const isFile = file instanceof TFile;
    if (isFile && file.extension !== "md") return;
    if (isFile) this.plugin.cache.drop(file.path);
    if (!t) return;
    const inside = (p: string): boolean => p === file.path || p.startsWith(file.path + "/");
    if (inside(t.note.path)) {
      this.scan?.stop();
      this.scan = null;
      this.target = null;
      this.render();
      return;
    }
    if (isFile && this.touchesTitle(file.path) && this.recheckTarget()) return;
    const scan = this.scan;
    if (!scan) return;
    if (isFile) scan.forget(file.path);
    else for (const p of [...scan.results.keys()]) if (inside(p)) scan.forget(p);
    this.requestRender();
  }

  private fileCreated(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== "md" || !this.target) return;
    if (this.touchesTitle(file.path) && this.recheckTarget()) return;
    this.refreshFile(file);
  }

  // ───── الفتح ─────

  private async openMention(source: string, m: Found | undefined, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const s = this.plugin.s;
    const file = this.app.vault.getFileByPath(source);
    if (!file) {
      new Notice(s.t("sourceGone"));
      this.scan?.forget(source);
      this.plugin.cache.drop(source);
      this.render();
      return;
    }
    if (m) {
      this.visited.add(source + "\u0000" + m.start);
      this.uiVersion++;
    }
    // فتح موضع من اللوحة لا يغيّر هدفها: الملف المفتوح يُعدّ «مرئيًا» قبل أن يُطلق حدثه
    this.lastActive = file.path;
    const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(evt));
    await leaf.openFile(file, { active: true, eState: m ? { line: m.line } : undefined });
    this.lastActive = this.app.workspace.getActiveFile()?.path ?? null;
    if (m && leaf.view instanceof MarkdownView && leaf.view.getMode() === "source") {
      const ed = leaf.view.editor;
      const from = ed.offsetToPos(m.start);
      const to = ed.offsetToPos(m.end);
      // المحرر قد يحمل تعديلات لم تُحفظ: لا يُحدَّد إلا ما يطابق المقطع
      if (ed.getRange(from, to) === m.surface) {
        ed.setSelection(from, to);
        ed.scrollIntoView({ from, to }, true);
      }
    }
    this.render();
  }

  // ───── الرسم ─────

  private requestRender(): void {
    if (this.closed || this.renderTimer !== null) return;
    const wait = Math.max(0, RENDER_EVERY - (Date.now() - this.lastRender));
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, wait);
  }

  private render(): void {
    if (this.closed || !this.topEl) return;
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.lastRender = Date.now();
    const t0 = performance.now();
    try {
      this.draw();
    } finally {
      this.lastRenderMs = performance.now() - t0;
    }
  }

  /**
   * يعيد بناء الرأس حين تتغيّر حالته فقط، والقائمة حين يتغيّر ما يُعرض فقط؛ نص التقدّم وشريطه يُحدَّثان
   * في مكانهما. البناء الكامل كل ربع ثانية أثناء البحث كان يُضيّع النقرات وتركيز لوحة المفاتيح.
   */
  private draw(): void {
    const s = this.plugin.s;
    const st = this.plugin.settings;
    this.contentEl.dir = s.lang === "ar" ? "rtl" : "ltr";
    const t = this.target;
    const scan = this.scan;
    const p = t && t.index.size ? present(scan ? scan.results.values() : [], st, (path, m) => this.hideReason(path, m)) : null;
    const running = scan ? scan.state === "running" || this.pausedHidden : !!t && (this.wantScan || this.startTimer !== null);
    const mode: Mode = !t ? "none" : !t.index.size ? "unsearchable" : running ? "running" : (scan?.state ?? "idle");
    const active = this.app.workspace.getActiveFile();
    const openNow = t && active && active.extension === "md" && active.path !== t.note.path ? active : null;
    const total = p ? p.mainCount + p.possibleCount : 0;

    const headKey = JSON.stringify([s.lang, t?.sig, t?.sameTitle, mode, p?.hidden, p?.ignored, this.showIgnored, total > 0, openNow?.path, scan?.failed ?? 0, this.plugin.undo.size > 0]);
    const bodyKey = JSON.stringify([s.lang, t?.sig, this.scanSerial, scan?.version, st.possible, st.quotes, st.firstMentionOnly, this.uiVersion, mode, this.plugin.ignore.size]);
    // المؤشر مضغوط داخل اللوحة: يؤجَّل البناء حتى يُرفع، كي تصل النقرة إلى العنصر الذي ضُغط
    const focus = this.focusKey();
    const hold = this.pointerDownAt > 0 && Date.now() - this.pointerDownAt < HOLD_MAX;
    if (hold) this.requestRender();
    let rebuilt = false;
    if (headKey !== this.headKey && !hold) {
      this.headKey = headKey;
      this.drawHead(t, scan, p, mode, openNow);
      rebuilt = true;
    }
    this.updateStatus(scan, p, mode);
    if (bodyKey !== this.bodyKey && !hold) {
      this.bodyKey = bodyKey;
      const scrollTop = this.contentEl.scrollTop;
      this.bodyEl.empty();
      this.drawBody(t, scan, p, mode);
      this.contentEl.scrollTop = scrollTop;
      rebuilt = true;
    }
    if (rebuilt) this.restoreFocus(focus);
  }

  private drawHead(t: Target | null, scan: Scan | null, p: Presented | null, mode: Mode, openNow: TFile | null): void {
    const s = this.plugin.s;
    this.topEl.empty();
    this.statusEl = null;
    this.progressEl = null;
    if (!t) return;
    this.renderTarget(t);
    if (!t.index.size || !p) return;
    const row = this.topEl.createDiv("wasl-status");
    this.statusEl = row.createDiv("wasl-status-text");
    const buttons = row.createDiv("wasl-status-buttons");
    if (mode === "running") {
      this.textButton(buttons, s.t("stop"), () => this.stopByUser(), "st:stop");
    } else if (mode === "failed") {
      this.statusEl.addClass("is-error");
      this.textButton(buttons, s.t("retry"), () => this.rescan(), "st:retry");
    } else if (mode === "stopped") {
      this.textButton(buttons, s.t("resume"), () => void this.runScan(), "st:resume");
      this.iconButton(buttons, "refresh-cw", s.t("rescan"), () => this.rescan(), "st:rescan");
    } else {
      // زر القياس على الجوال (ت٣): لوحة الأوامر صعبة الوصول هناك. مؤقت، يُزال مع الأمر قبل 1.0.0
      const file = this.app.vault.getFileByPath(t.note.path);
      if (Platform.isMobile && mode === "done" && file) this.iconButton(buttons, "timer", s.t("measureCommand"), () => void showMeasurement(this.plugin, file), "st:measure");
      this.iconButton(buttons, "refresh-cw", s.t("rescan"), () => this.rescan(), "st:rescan");
    }
    // التراجع بنقرة واحدة: لوحة الأوامر صعبة على الجوال
    if (this.plugin.undo.size) this.iconButton(buttons, "undo-2", s.t("undoCommand"), () => void this.plugin.undoLastLink(), "st:undo");
    if (p.hidden) {
      const h = this.topEl.createDiv("wasl-hidden");
      h.createSpan({ text: s.t("hiddenBySettings", { n: p.hidden }) });
      if (mode !== "running" && !p.mainCount && !p.possibleCount) this.textButton(h, s.t("openSettings"), () => this.openSettings(), "st:settings");
    }
    if (p.ignored || this.showIgnored) {
      const h = this.topEl.createDiv("wasl-hidden");
      if (p.ignored) h.createSpan({ text: s.t("ignoredCount", { n: p.ignored }) });
      this.textButton(h, s.t(this.showIgnored ? "hideIgnored" : "showIgnored"), () => this.toggleIgnored(), "st:ignored").addClass("wasl-link-button");
    }
    if (mode === "running") {
      const bar = this.topEl.createDiv({ cls: "wasl-progress", attr: { "aria-hidden": "true" } });
      this.progressEl = bar.createDiv("wasl-progress-bar");
    }
    this.renderNotes(t, scan, openNow);
  }

  /** نص الحالة وشريط التقدّم في مكانهما، بلا إعادة بناء. */
  private updateStatus(scan: Scan | null, p: Presented | null, mode: Mode): void {
    const s = this.plugin.s;
    let line = "";
    if (mode === "running") line = scan && scan.total ? s.t("scanning", { done: scan.done, notes: s.notes(scan.total) }) : s.t("searching");
    else if (mode === "failed") line = s.t("failed");
    else if (mode === "stopped" && scan) line = s.t("stopped", { done: scan.done, notes: s.notes(scan.total) });
    else if (p && p.mainCount + p.possibleCount)
      line = s.t("summary", { mentions: s.mentions(p.mainCount + p.possibleCount), notes: s.notes(p.noteCount) }) + s.possibleOf(p.possibleCount);
    this.statusEl?.setText(line);
    if (this.progressEl) {
      const pct = scan && scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
      this.progressEl.setCssProps({ "--wasl-progress": `${pct}%` });
    }
    this.announce(line, mode !== "running");
  }

  private drawBody(t: Target | null, scan: Scan | null, p: Presented | null, mode: Mode): void {
    const s = this.plugin.s;
    if (!t) {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("noNote") });
      return;
    }
    if (!t.index.size) {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("unsearchable", { name: t.note.title }) });
      return;
    }
    if (!p) return;
    const dup = duplicateNames([...p.main, ...p.possible]);
    if (p.mainCount) this.renderSection("main", p.main, p.mainCount, dup);
    if (p.possibleCount) this.renderSection("possible", p.possible, p.possibleCount, dup);
    if (mode === "done" && scan && !p.mainCount && !p.possibleCount) {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("none", { name: t.note.title, notes: s.notes(scan.total) }) });
    }
  }

  /** مفتاح العنصر الذي عليه التركيز داخل اللوحة، ليعود إليه بعد البناء. */
  private focusKey(): string | null {
    const a = this.contentEl.ownerDocument.activeElement;
    if (!a || !this.contentEl.contains(a)) return null;
    return a.closest("[data-wasl-key]")?.getAttribute("data-wasl-key") ?? null;
  }

  private restoreFocus(key: string | null): void {
    if (!key) return;
    for (const el of Array.from(this.contentEl.querySelectorAll<HTMLElement>("[data-wasl-key]"))) {
      if (el.getAttribute("data-wasl-key") === key) {
        el.focus({ preventScroll: true });
        return;
      }
    }
    // زر الحالة تبدّل («أوقف البحث» صار «أعد البحث» مثلًا): التركيز على بديله لا على الصفحة
    if (key.startsWith("st:")) this.topEl.querySelector<HTMLElement>(".wasl-status-buttons button")?.focus({ preventScroll: true });
  }

  private renderTarget(t: Target): void {
    const s = this.plugin.s;
    const head = this.topEl.createDiv("wasl-target");
    head.createSpan({ cls: "wasl-target-name", text: t.note.title, attr: { dir: "auto" } });
    for (const alias of t.note.aliases ?? []) {
      // الفاصل عنصر مستقل: داخل اسم لاتيني بـdir=auto يقع على الجهة الخطأ
      head.createSpan({ cls: "wasl-sep", text: "·", attr: { "aria-hidden": "true" } });
      head.createSpan({ cls: "wasl-target-alias", text: alias, attr: { dir: "auto" } });
    }
    if (t.note.exactOnly || t.note.indefinite) {
      const badges = this.topEl.createDiv("wasl-badges");
      if (t.note.exactOnly) badges.createSpan({ cls: "wasl-badge", text: s.t("exactOnly") });
      if (t.note.indefinite) badges.createSpan({ cls: "wasl-badge", text: s.t("indefinite") });
    }
  }

  /** تنبيه الالتباس، و«المفتوحة الآن»، وأخطاء القراءة. */
  private renderNotes(t: Target, scan: Scan | null, openNow: TFile | null): void {
    const s = this.plugin.s;
    if (t.sameTitle.length) {
      const folders = t.sameTitle
        .map((p) => {
          const folder = folderOf(p);
          return folder ? `«${folder.split("/").join(" › ")}»` : s.t("rootFolder");
        })
        .join(s.t("listSep"));
      this.topEl.createDiv({ cls: "wasl-note", text: s.t("ambiguous", { folders }) });
    }
    if (openNow) {
      const line = this.topEl.createDiv("wasl-note wasl-open-now");
      line.createSpan({ text: s.t("openNow", { name: openNow.basename }) });
      line.createSpan({ cls: "wasl-sep", text: " · ", attr: { "aria-hidden": "true" } });
      const b = line.createEl("button", { cls: "wasl-link-button", text: s.t("showActive") });
      b.dataset.waslKey = key("show-active");
      b.onclick = () => this.setTarget(openNow, { now: true });
    }
    if (scan?.failed) this.topEl.createDiv({ cls: "wasl-error", text: s.t("readErrors", { notes: s.notes(scan.failed) }) });
  }

  private renderSection(section: Section, groups: readonly Group[], count: number, dup: ReadonlySet<string>): void {
    const s = this.plugin.s;
    const open = this.sectionOpen[section];
    const wrap = this.bodyEl.createDiv(`wasl-section wasl-section-${section}`);
    const head = wrap.createEl("button", { cls: "wasl-section-head", attr: { "aria-expanded": String(open) } });
    head.dataset.waslKey = key("sec", section);
    this.chevron(head, open);
    head.createSpan({ cls: "wasl-section-title", text: section === "main" ? s.t("sectionMain") : s.t("sectionPossible") });
    head.createSpan({ cls: "wasl-count", text: s.num(count) });
    head.onclick = () => {
      this.sectionOpen[section] = !open;
      this.uiVersion++;
      this.render();
    };
    if (section === "possible") wrap.createDiv({ cls: "wasl-hint", text: s.t("possibleHint") });
    if (!open) return;
    const limit = this.groupLimit[section];
    for (const g of groups.slice(0, limit)) this.renderGroup(wrap, section, g, dup);
    if (groups.length > limit) {
      this.textButton(
        wrap,
        s.t("showRest", { n: s.notes(groups.length - limit) }),
        () => {
          this.groupLimit[section] += GROUP_STEP;
          this.uiVersion++;
          this.render();
        },
        key("rest", section),
      ).addClass("wasl-show-rest");
    }
  }

  private renderGroup(parent: HTMLElement, section: Section, g: Group, dup: ReadonlySet<string>): void {
    const s = this.plugin.s;
    const id = section + "\u0000" + g.path;
    const open = !this.collapsed.has(id);
    const name = basename(g.path);
    const el = parent.createDiv("wasl-group");
    const head = el.createDiv("wasl-group-head");
    const toggle = head.createEl("button", {
      cls: "wasl-toggle clickable-icon",
      attr: { "aria-expanded": String(open), "aria-label": name },
    });
    toggle.dataset.waslKey = key("toggle", section, g.path);
    this.chevron(toggle, open);
    toggle.onclick = () => {
      if (open) this.collapsed.add(id);
      else this.collapsed.delete(id);
      this.uiVersion++;
      this.render();
    };
    const link = head.createEl("button", { cls: "wasl-group-name" });
    link.dataset.waslKey = key("group", section, g.path);
    link.createSpan({ text: name, attr: { dir: "auto" } });
    const folder = folderOf(g.path);
    if (folder && dup.has(name)) link.createEl("bdi", { cls: "wasl-folder", text: folder.split("/").join(" › ") });
    link.onclick = (e) => void this.openMention(g.path, g.items[0], e);
    head.createSpan({ cls: "wasl-count", text: s.num(g.items.length) });
    if (!open) return;
    const shown = visibleCount(g.items.length, this.expanded.has(id));
    for (const m of g.items.slice(0, shown)) this.renderCard(el, g.path, m);
    if (shown < g.items.length) {
      this.textButton(
        el,
        s.t("showRest", { n: g.items.length - shown }),
        () => {
          this.expanded.add(id);
          this.uiVersion++;
          this.render();
        },
        key("rest", section, g.path),
      ).addClass("wasl-show-rest");
    }
  }

  private renderCard(parent: HTMLElement, source: string, m: Found): void {
    const s = this.plugin.s;
    const card = parent.createDiv({ cls: "wasl-card", attr: { tabindex: "0" } });
    card.dataset.waslKey = key("card", source, m.start);
    const k = (action: string): string => key(action, source, m.start);
    if (this.visited.has(source + "\u0000" + m.start)) card.addClass("is-visited");

    const sn = m.snippet;
    const snippet = card.createDiv({ cls: "wasl-snippet", attr: { dir: sn.dir ?? "auto" } });
    if (sn.cutStart) snippet.createSpan({ cls: "wasl-cut", text: "…", attr: { "aria-hidden": "true" } });
    snippet.appendText(sn.text.slice(0, sn.matchStart));
    snippet.createEl("mark", { cls: "wasl-match", text: sn.text.slice(sn.matchStart, sn.matchEnd) });
    snippet.appendText(sn.text.slice(sn.matchEnd));
    if (sn.cutEnd) snippet.createSpan({ cls: "wasl-cut", text: "…", attr: { "aria-hidden": "true" } });
    snippet.onclick = (e) => void this.openMention(source, m, e);
    card.onkeydown = (e) => {
      // Enter على زر داخل البطاقة يفعل فعل الزر وحده
      if (e.key === "Enter" && e.target === card) void this.openMention(source, m, e);
    };

    const tags = card.createDiv("wasl-tags");
    for (const tag of tagsFor(m)) {
      const el = tags.createSpan({ cls: tag.minor ? "wasl-tag is-minor" : "wasl-tag" });
      if (tag.detail === undefined) {
        el.setText(s.t(tag.key));
      } else {
        const [before, after] = s.t(tag.key, { d: "\u0001" }).split("\u0001");
        el.appendText(before ?? "");
        el.createEl("bdi", { text: tag.detail });
        el.appendText(after ?? "");
      }
    }

    const cardId = source + "\u0000" + m.start;
    if (this.preview === cardId) {
      this.renderPreview(card, source, m);
      return;
    }

    const ignoredAs = this.showIgnored && this.target ? this.plugin.ignore.isIgnored(this.target.note.path, source, m) : null;
    if (ignoredAs) {
      card.addClass("is-ignored");
      tags.createSpan({ cls: "wasl-tag", text: s.t(ignoredAs === "form" ? "tagIgnoredForm" : "tagIgnored") });
    }

    const actions = card.createDiv("wasl-actions");
    if (ignoredAs) {
      this.textButton(actions, s.t("unignore"), () => void this.unignore(source, m), k("unignore")).addClass("mod-ignore");
    } else {
      this.textButton(actions, s.t("link"), () => this.openPreview(cardId), k("mod-link")).addClass("mod-link");
      this.textButton(actions, s.t("ignore"), () => void this.ignoreMention(source, m), k("mod-ignore")).addClass("mod-ignore");
    }
    this.textButton(actions, s.t("open"), (e) => void this.openMention(source, m, e), k("open"));
    if (ignoredAs) return;
    const more = this.iconButton(
      actions,
      "more-horizontal",
      s.t("more"),
      () => {
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle(s.t("ignoreForm"))
            .setIcon("eye-off")
            .onClick(() => void this.ignoreForm(m)),
        );
        // من مستطيل الزر لا من الحدث: Enter يطلق نقرة بإحداثيات صفرية، والنافذة المنبثقة لها MouseEvent آخر
        const r = more.getBoundingClientRect();
        menu.showAtPosition({ x: r.left, y: r.bottom });
      },
      k("more"),
    );
    more.addClass("wasl-more");
  }

  // ───── المعاينة والربط (البند ٧) ─────

  private openPreview(cardId: string): void {
    this.preview = cardId;
    this.uiVersion++;
    this.render();
    // التركيز على «أكّد الربط» كي يصل إليه من يستعمل لوحة المفاتيح مباشرة
    this.bodyEl.querySelector<HTMLElement>(".wasl-preview .mod-cta")?.focus({ preventScroll: true });
  }

  private closePreview(): void {
    this.preview = null;
    this.uiVersion++;
    this.render();
  }

  /** سطرا «قبل» و«بعد» بالسياق نفسه، وتحتهما «أكّد الربط» و«ألغِ». الرابط كما سيُكتب حرفيًا. */
  private renderPreview(card: HTMLElement, source: string, m: Found): void {
    const s = this.plugin.s;
    const k = (action: string): string => key(action, source, m.start);
    const target = this.app.vault.getFileByPath(m.path);
    const box = card.createDiv("wasl-preview");
    if (!target) {
      box.createDiv({ cls: "wasl-error", text: s.t("targetGone") });
      this.textButton(box.createDiv("wasl-preview-actions"), s.t("cancel"), () => this.closePreview(), k("cancel"));
      return;
    }
    const link = generateLink(this.app, target, source, m.surface, m.flags.includes("table"));
    const sn = m.snippet;
    const after = previewAfter(sn, link);
    const row = (label: string, text: string, from: number, to: number, cls: string): void => {
      const r = box.createDiv("wasl-preview-row");
      r.createSpan({ cls: "wasl-preview-label", text: label });
      const t = r.createDiv({ cls: "wasl-preview-text", attr: { dir: sn.dir ?? "auto" } });
      if (sn.cutStart) t.createSpan({ cls: "wasl-cut", text: "…", attr: { "aria-hidden": "true" } });
      t.appendText(text.slice(0, from));
      t.createEl("mark", { cls, text: text.slice(from, to) });
      t.appendText(text.slice(to));
      if (sn.cutEnd) t.createSpan({ cls: "wasl-cut", text: "…", attr: { "aria-hidden": "true" } });
    };
    row(s.t("previewBefore"), sn.text, sn.matchStart, sn.matchEnd, "wasl-match");
    row(s.t("previewAfter"), after.text, after.linkStart, after.linkEnd, "wasl-match wasl-link-text");
    const actions = box.createDiv("wasl-preview-actions");
    const confirm = this.textButton(actions, s.t("confirmLink"), () => this.confirmLink(source, m, link), k("confirm"));
    confirm.addClass("mod-cta");
    this.textButton(actions, s.t("cancel"), () => this.closePreview(), k("cancel"));
    box.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.closePreview();
      }
    };
  }

  /** لماذا يُخفى موضع من القائمة: رُبط للتو، أو تجاهله المستخدم (ما لم يطلب إظهار المتجاهَل). */
  private hideReason(source: string, m: Found): HideReason | undefined {
    if (this.linked.has(source + "\u0000" + m.start)) return "linked";
    if (!this.showIgnored && this.target && this.plugin.ignore.isIgnored(this.target.note.path, source, m)) return "ignored";
    return undefined;
  }

  // ───── التجاهل (الخطوة ٣.٤) ─────

  private async ignoreMention(source: string, m: Found): Promise<void> {
    const t = this.target;
    if (!t) return;
    if (this.plugin.ignore.ignoreMention(t.note.path, source, fingerprint(m.surface, m.snippet))) await this.plugin.saveIgnore();
    this.uiVersion++;
    this.render();
  }

  private async ignoreForm(m: Found): Promise<void> {
    const t = this.target;
    if (!t) return;
    if (this.plugin.ignore.ignoreForm(t.note.path, formKey(m.surface))) await this.plugin.saveIgnore();
    this.uiVersion++;
    this.render();
  }

  private async unignore(source: string, m: Found): Promise<void> {
    const t = this.target;
    if (!t) return;
    if (this.plugin.ignore.unignore(t.note.path, source, m)) await this.plugin.saveIgnore();
    this.uiVersion++;
    this.render();
  }

  private toggleIgnored(): void {
    this.showIgnored = !this.showIgnored;
    this.uiVersion++;
    this.render();
  }

  /** الكتابة بعد التحقق (الخطوة ٣.٢). عند الامتناع يُقال السبب ويُعاد مسح الملف ليُصحَّح الموضع. */
  private async confirmLink(source: string, m: Found, link: string): Promise<void> {
    if (this.linking) return;
    this.linking = true;
    const s = this.plugin.s;
    let outcome: Awaited<ReturnType<typeof writeLink>>;
    try {
      outcome = await writeLink(this.app, source, m, link);
    } catch (e) {
      console.error("Wasl: link failed", e);
      outcome = { ok: false, reason: "changed" };
      new Notice(s.t("linkFailed"));
    } finally {
      this.linking = false;
    }
    this.preview = null;
    if (outcome.ok) {
      this.linked.add(source + "\u0000" + m.start);
      this.plugin.undo.push({ path: source, start: outcome.start, surface: m.surface, link, at: Date.now() });
    } else {
      const why: Record<WriteFailure, Parameters<typeof s.t>[0]> = { changed: "linkChanged", ambiguous: "linkAmbiguous", protected: "linkProtected", missing: "sourceGone" };
      new Notice(s.t(why[outcome.reason]));
    }
    this.uiVersion++;
    this.render();
    // الملف تغيّر (أو تبيّن أنه تغيّر): تُحدَّث نتيجته وحدها
    const file = this.app.vault.getFileByPath(source);
    if (file) {
      this.refreshFile(file);
    } else {
      this.scan?.forget(source);
      this.plugin.cache.drop(source);
      this.requestRender();
    }
  }

  private chevron(parent: HTMLElement, open: boolean): void {
    const c = parent.createSpan({ cls: open ? "wasl-chevron" : "wasl-chevron is-collapsed", attr: { "aria-hidden": "true" } });
    setIcon(c, "chevron-down");
  }

  private textButton(parent: HTMLElement, label: string, onClick: (e: MouseEvent) => void, focusKey?: string): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "wasl-button", text: label });
    if (focusKey) b.dataset.waslKey = focusKey;
    b.onclick = (e) => {
      e.stopPropagation();
      onClick(e);
    };
    return b;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void, focusKey?: string): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "wasl-icon-button clickable-icon", attr: { "aria-label": label } });
    if (focusKey) b.dataset.waslKey = focusKey;
    setIcon(b, icon);
    b.onclick = (e) => {
      e.stopPropagation();
      onClick(e);
    };
    return b;
  }

  /** منطقة قارئ الشاشة: مرة كل ثانيتين على الأكثر، وفورًا عند تغيّر الحالة. */
  private announce(text: string, force: boolean): void {
    const now = Date.now();
    if (text === this.announced || (!force && now - this.lastAnnounce < ANNOUNCE_EVERY)) return;
    this.lastAnnounce = now;
    this.announced = text;
    this.liveEl.setText(text);
  }

  private openSettings(): void {
    // واجهة الإعدادات ليست في التعريفات العامة؛ إن غابت لا يحدث شيء
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.plugin.manifest.id);
  }
}
