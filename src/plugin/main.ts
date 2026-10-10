import { moment, Notice, Plugin, TFile, type TAbstractFile } from "obsidian";
import { resolveLang, strings, type Strings } from "./i18n";
import { IgnoreList } from "./ignore";
import { undoLink } from "./linker";
import { showMeasurement } from "./measure";
import { basename } from "./present";
import { ResultCache } from "./scan";
import { WaslSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, readSettings, type WaslSettings } from "./settings";
import { UndoLog } from "./undo";
import { MentionsView, VIEW_TYPE } from "./view";

/**
 * وصل: اكتشاف الإشارات العربية غير المربوطة.
 * لوحة جانبية تعرض المواضع، وربط موضعًا موضعًا بمعاينة وتحقق وتراجع (المرحلة ٣).
 */
export default class WaslPlugin extends Plugin {
  override settings: WaslSettings = { ...DEFAULT_SETTINGS };
  s: Strings = strings("en");
  /** ذاكرة النتائج مشتركة بين اللوحات، وتبقى ما دامت الإضافة محمّلة. */
  readonly cache = new ResultCache();
  /** سجل الربط للتراجع؛ في الذاكرة ما دامت الإضافة محمّلة. */
  readonly undo = new UndoLog();
  /** ما تجاهله المستخدم؛ يُحفظ مع الإعدادات في `data.json`. */
  ignore = new IgnoreList();

  override async onload(): Promise<void> {
    this.readData(await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new MentionsView(leaf, this));
    // أسماء الأوامر بلا اسم الإضافة: Obsidian يضيفه (إرشادات الإضافات)
    this.addCommand({ id: "show-unlinked-mentions", name: this.s.t("commandShow"), callback: () => void this.activateView() });
    this.addCommand({
      id: "measure-search-time",
      name: this.s.t("measureCommand"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void showMeasurement(this, file);
        return true;
      },
    });
    this.addCommand({
      id: "undo-last-link",
      name: this.s.t("undoCommand"),
      checkCallback: (checking) => {
        if (!this.undo.size) return false;
        if (!checking) void this.undoLastLink();
        return true;
      },
    });
    this.addRibbonIcon("link", this.s.t("commandShow"), () => void this.activateView());
    this.addSettingTab(new WaslSettingTab(this.app, this));
    // سجلات الربط تتبع الملفات؛ بعد جاهزية التخطيط كي لا تُستقبل أحداث الفتح
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          this.undo.rename(oldPath, file.path);
          if (this.ignore.rename(oldPath, file.path)) void this.persist();
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file: TAbstractFile) => {
          this.undo.drop(file.path);
          if (this.ignore.drop(file.path)) void this.persist();
        }),
      );
    });
  }

  private readData(raw: unknown): void {
    this.settings = readSettings(raw);
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    this.ignore = IgnoreList.read(r.ignored);
    this.applyLanguage();
  }

  /** يكتب الإعدادات وقائمة التجاهل معًا في `data.json`. */
  async persist(): Promise<void> {
    await this.saveData({ ...this.settings, ignored: this.ignore.toJSON() });
  }

  /** يتراجع عن آخر ربط مسجّل إن كان الرابط ما زال كما كُتب؛ وإلا يُسقط السجل ويقول السبب. */
  async undoLastLink(): Promise<void> {
    const r = this.undo.pop();
    if (!r) return;
    const name = basename(r.path);
    let outcome: Awaited<ReturnType<typeof undoLink>>;
    try {
      outcome = await undoLink(this.app, r);
    } catch (e) {
      console.error("Wasl: undo failed", e);
      new Notice(this.s.t("undoFailed"));
      return;
    }
    if (outcome.ok) new Notice(this.s.t("undoDone", { name }));
    else new Notice(this.s.t(outcome.reason === "missing" ? "undoGone" : "undoStale", { name }));
    const file = this.app.vault.getFileByPath(r.path);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof MentionsView) leaf.view.linkUndone(file instanceof TFile ? file : null);
    }
  }

  /** يفتح اللوحة في الشريط الأيمن أو يُظهرها إن كانت مفتوحة. */
  async activateView(): Promise<void> {
    await this.app.workspace.ensureSideLeaf(VIEW_TYPE, "right", { active: true, reveal: true });
  }

  applyLanguage(): void {
    this.s = strings(resolveLang(this.settings.language, moment.locale()));
  }

  /** `rescan`: تغيّر ما يُبحث فيه (المجلدات المستثناة)، لا طريقة العرض فقط. */
  async saveSettings(opts: { rescan?: boolean } = {}): Promise<void> {
    await this.persist();
    this.applyLanguage();
    this.refreshViews(opts.rescan ?? false);
  }

  /** قائمة التجاهل تغيّرت: تُحفظ وتُعاد الرسم، بلا بحث جديد (التصفية عند العرض). */
  async saveIgnore(): Promise<void> {
    await this.persist();
    this.refreshViews(false);
  }

  /** الإعدادات أو قائمة التجاهل تغيّرت من خارج التطبيق (المزامنة). */
  override async onExternalSettingsChange(): Promise<void> {
    const before = this.settings.excludedFolders.join("\n");
    this.readData(await this.loadData());
    this.refreshViews(before !== this.settings.excludedFolders.join("\n"));
  }

  private refreshViews(rescan: boolean): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof MentionsView) leaf.view.settingsChanged(rescan);
    }
  }
}
