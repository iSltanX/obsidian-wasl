import {
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  setIcon,
  TFile,
  type TAbstractFile,
  type WorkspaceLeaf,
} from "obsidian";
import type { Found } from "./context";
import type WaslPlugin from "./main";
import { basename, duplicateNames, folderOf, present, tagsFor, visibleCount, type Group } from "./present";
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

type Section = "main" | "possible";

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
      this.target = next;
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
      scan.results.delete(file.path);
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

  private fileRenamed(file: TAbstractFile, oldPath: string): void {
    if (this.lastActive === oldPath) this.lastActive = file.path;
    if (!(file instanceof TFile)) {
      // مجلد: مسارات ما فيه تغيّرت، وربما الهدف معها؛ بحث جديد يقرأ ما لم يُحفظ بمساره الجديد
      const t = this.target;
      if (!t) return;
      const moved = t.note.path.startsWith(oldPath + "/") ? this.app.vault.getFileByPath(file.path + t.note.path.slice(oldPath.length)) : null;
      if (moved) this.setTarget(moved, { now: true });
      else if (!this.recheckTarget()) this.queueScan(0);
      return;
    }
    if (file.extension !== "md") return;
    this.plugin.cache.rename(oldPath, file.path);
    if (!this.target) return;
    if (this.target.note.path === oldPath) {
      this.setTarget(file, { now: true });
      return;
    }
    if (this.recheckTarget()) return; // عنوان مكرر ظهر أو زال
    const scan = this.scan;
    const prev = scan?.results.get(oldPath);
    scan?.results.delete(oldPath);
    if (scan && prev && !isExcluded(file.path, this.plugin.settings.excludedFolders)) {
      scan.results.set(file.path, { ...prev, path: file.path });
      this.requestRender();
    } else {
      this.refreshFile(file);
    }
  }

  private fileDeleted(file: TAbstractFile): void {
    this.plugin.cache.drop(file.path);
    if (!this.target) return;
    if (file.path === this.target.note.path) {
      this.scan?.stop();
      this.scan = null;
      this.target = null;
      this.render();
      return;
    }
    if (this.recheckTarget()) return;
    const scan = this.scan;
    if (!scan) return;
    for (const path of [...scan.results.keys()]) if (!this.app.vault.getFileByPath(path)) scan.results.delete(path);
    this.requestRender();
  }

  private fileCreated(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== "md" || !this.target) return;
    if (this.recheckTarget()) return;
    this.refreshFile(file);
  }

  // ───── الفتح ─────

  private async openMention(source: string, m: Found | undefined, evt: MouseEvent | KeyboardEvent): Promise<void> {
    const s = this.plugin.s;
    const file = this.app.vault.getFileByPath(source);
    if (!file) {
      new Notice(s.t("sourceGone"));
      this.scan?.results.delete(source);
      this.plugin.cache.drop(source);
      this.render();
      return;
    }
    if (m) this.visited.add(source + "\u0000" + m.start);
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

  private draw(): void {
    const s = this.plugin.s;
    this.contentEl.dir = s.lang === "ar" ? "rtl" : "ltr";
    const scrollTop = this.contentEl.scrollTop;
    this.topEl.empty();
    this.bodyEl.empty();

    const t = this.target;
    if (!t) {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("noNote") });
      return;
    }
    this.renderTarget(t);
    if (!t.index.size) {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("unsearchable", { name: t.note.title }) });
      return;
    }

    const scan = this.scan;
    const p = present(scan ? scan.results.values() : [], this.plugin.settings);
    const running = !scan || scan.state === "running" || this.pausedHidden;
    this.renderStatus(scan, running, p.mainCount + p.possibleCount, p.noteCount, p.possibleCount, p.hidden);
    this.renderNotes(t, scan);

    const dup = duplicateNames([...p.main, ...p.possible]);
    if (p.mainCount) this.renderSection("main", p.main, p.mainCount, dup);
    if (p.possibleCount) this.renderSection("possible", p.possible, p.possibleCount, dup);
    if (!running && !p.mainCount && !p.possibleCount && scan?.state === "done") {
      this.bodyEl.createDiv({ cls: "wasl-empty", text: s.t("none", { name: t.note.title, notes: s.notes(scan.total) }) });
    }
    this.contentEl.scrollTop = scrollTop;
  }

  private renderTarget(t: Target): void {
    const s = this.plugin.s;
    const head = this.topEl.createDiv("wasl-target");
    head.createSpan({ cls: "wasl-target-name", text: t.note.title, attr: { dir: "auto" } });
    for (const alias of t.note.aliases ?? []) head.createSpan({ cls: "wasl-target-alias", text: alias, attr: { dir: "auto" } });
    if (t.note.exactOnly || t.note.indefinite) {
      const badges = this.topEl.createDiv("wasl-badges");
      if (t.note.exactOnly) badges.createSpan({ cls: "wasl-badge", text: s.t("exactOnly") });
      if (t.note.indefinite) badges.createSpan({ cls: "wasl-badge", text: s.t("indefinite") });
    }
  }

  private renderStatus(scan: Scan | null, running: boolean, total: number, notes: number, possible: number, hidden: number): void {
    const s = this.plugin.s;
    const row = this.topEl.createDiv("wasl-status");
    const text = row.createDiv("wasl-status-text");
    const buttons = row.createDiv("wasl-status-buttons");
    let line = "";
    if (running) {
      line = scan && scan.total ? s.t("scanning", { done: scan.done, notes: s.notes(scan.total) }) : s.t("searching");
      text.setText(line);
      this.textButton(buttons, s.t("stop"), () => this.stopByUser());
    } else if (scan?.state === "failed") {
      line = s.t("failed");
      text.setText(line);
      text.addClass("is-error");
      this.textButton(buttons, s.t("retry"), () => this.rescan());
    } else if (scan?.state === "stopped") {
      line = s.t("stopped", { done: scan.done, notes: s.notes(scan.total) });
      text.setText(line);
      this.textButton(buttons, s.t("resume"), () => void this.runScan());
      this.iconButton(buttons, "refresh-cw", s.t("rescan"), () => this.rescan());
    } else {
      if (total) {
        line = s.t("summary", { mentions: s.mentions(total), notes: s.notes(notes) }) + s.possibleOf(possible);
        text.setText(line);
      }
      this.iconButton(buttons, "refresh-cw", s.t("rescan"), () => this.rescan());
    }
    if (hidden) {
      const h = this.topEl.createDiv("wasl-hidden");
      h.createSpan({ text: s.t("hiddenBySettings", { n: hidden }) });
      if (!running && !total) this.textButton(h, s.t("openSettings"), () => this.openSettings());
    }
    if (running) {
      const bar = this.topEl.createDiv({ cls: "wasl-progress", attr: { "aria-hidden": "true" } });
      const pct = scan && scan.total ? Math.round((scan.done / scan.total) * 100) : 0;
      bar.createDiv("wasl-progress-bar").setCssProps({ "--wasl-progress": `${pct}%` });
    }
    this.announce(line, !running);
  }

  /** تنبيه الالتباس، و«المفتوحة الآن»، وأخطاء القراءة. */
  private renderNotes(t: Target, scan: Scan | null): void {
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
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === "md" && active.path !== t.note.path) {
      const line = this.topEl.createDiv("wasl-note wasl-open-now");
      line.createSpan({ text: s.t("openNow", { name: active.basename }) });
      line.createSpan({ cls: "wasl-sep", text: " · ", attr: { "aria-hidden": "true" } });
      const b = line.createEl("button", { cls: "wasl-link-button", text: s.t("showActive") });
      b.onclick = () => this.setTarget(active, { now: true });
    }
    if (scan?.failed) this.topEl.createDiv({ cls: "wasl-error", text: s.t("readErrors", { notes: s.notes(scan.failed) }) });
  }

  private renderSection(section: Section, groups: readonly Group[], count: number, dup: ReadonlySet<string>): void {
    const s = this.plugin.s;
    const open = this.sectionOpen[section];
    const wrap = this.bodyEl.createDiv(`wasl-section wasl-section-${section}`);
    const head = wrap.createEl("button", { cls: "wasl-section-head", attr: { "aria-expanded": String(open) } });
    this.chevron(head, open);
    head.createSpan({ cls: "wasl-section-title", text: section === "main" ? s.t("sectionMain") : s.t("sectionPossible") });
    head.createSpan({ cls: "wasl-count", text: s.num(count) });
    head.onclick = () => {
      this.sectionOpen[section] = !open;
      this.render();
    };
    if (section === "possible") wrap.createDiv({ cls: "wasl-hint", text: s.t("possibleHint") });
    if (!open) return;
    const limit = this.groupLimit[section];
    for (const g of groups.slice(0, limit)) this.renderGroup(wrap, section, g, dup);
    if (groups.length > limit) {
      this.textButton(wrap, s.t("showRest", { n: s.notes(groups.length - limit) }), () => {
        this.groupLimit[section] += GROUP_STEP;
        this.render();
      }).addClass("wasl-show-rest");
    }
  }

  private renderGroup(parent: HTMLElement, section: Section, g: Group, dup: ReadonlySet<string>): void {
    const s = this.plugin.s;
    const key = section + "\u0000" + g.path;
    const open = !this.collapsed.has(key);
    const name = basename(g.path);
    const el = parent.createDiv("wasl-group");
    const head = el.createDiv("wasl-group-head");
    const toggle = head.createEl("button", {
      cls: "wasl-toggle clickable-icon",
      attr: { "aria-expanded": String(open), "aria-label": name },
    });
    this.chevron(toggle, open);
    toggle.onclick = () => {
      if (open) this.collapsed.add(key);
      else this.collapsed.delete(key);
      this.render();
    };
    const link = head.createEl("button", { cls: "wasl-group-name" });
    link.createSpan({ text: name, attr: { dir: "auto" } });
    const folder = folderOf(g.path);
    if (folder && dup.has(name)) link.createEl("bdi", { cls: "wasl-folder", text: folder.split("/").join(" › ") });
    link.onclick = (e) => void this.openMention(g.path, g.items[0], e);
    head.createSpan({ cls: "wasl-count", text: s.num(g.items.length) });
    if (!open) return;
    const shown = visibleCount(g.items.length, this.expanded.has(key));
    for (const m of g.items.slice(0, shown)) this.renderCard(el, g.path, m);
    if (shown < g.items.length) {
      this.textButton(el, s.t("showRest", { n: g.items.length - shown }), () => {
        this.expanded.add(key);
        this.render();
      }).addClass("wasl-show-rest");
    }
  }

  private renderCard(parent: HTMLElement, source: string, m: Found): void {
    const s = this.plugin.s;
    const card = parent.createDiv({ cls: "wasl-card", attr: { tabindex: "0" } });
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

    const actions = card.createDiv("wasl-actions");
    // المرحلة ٢: الربط والتجاهل معطّلان؛ التلميح لا يظهر على اللمس فالنقر يعرض تنبيهًا
    const later = (label: string, cls: string): void => {
      const b = this.textButton(actions, label, () => new Notice(s.t("comingLater")));
      b.addClass(cls);
      b.addClass("is-disabled");
      b.setAttr("aria-disabled", "true");
    };
    later(s.t("link"), "mod-link");
    later(s.t("ignore"), "mod-ignore");
    this.textButton(actions, s.t("open"), (e) => void this.openMention(source, m, e));
    this.iconButton(actions, "more-horizontal", s.t("more"), (e) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(s.t("ignoreForm")).setDisabled(true));
      if (e instanceof MouseEvent) menu.showAtMouseEvent(e);
    }).addClass("wasl-more");
  }

  private chevron(parent: HTMLElement, open: boolean): void {
    const c = parent.createSpan({ cls: open ? "wasl-chevron" : "wasl-chevron is-collapsed", attr: { "aria-hidden": "true" } });
    setIcon(c, "chevron-down");
  }

  private textButton(parent: HTMLElement, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "wasl-button", text: label });
    b.onclick = (e) => {
      e.stopPropagation();
      onClick(e);
    };
    return b;
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const b = parent.createEl("button", { cls: "wasl-icon-button clickable-icon", attr: { "aria-label": label } });
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
