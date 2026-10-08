import { moment, Plugin } from "obsidian";
import { resolveLang, strings, type Strings } from "./i18n";
import { showMeasurement } from "./measure";
import { ResultCache } from "./scan";
import { WaslSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, readSettings, type WaslSettings } from "./settings";
import { MentionsView, VIEW_TYPE } from "./view";

/**
 * وصل: اكتشاف الإشارات العربية غير المربوطة.
 * المرحلة ٢: لوحة للقراءة فقط، وإعدادات، ومُجدوِل بحث. لا كتابة في الملفات.
 */
export default class WaslPlugin extends Plugin {
  override settings: WaslSettings = { ...DEFAULT_SETTINGS };
  s: Strings = strings("en");
  /** ذاكرة النتائج مشتركة بين اللوحات، وتبقى ما دامت الإضافة محمّلة. */
  readonly cache = new ResultCache();

  override async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.applyLanguage();

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
    this.addRibbonIcon("link", this.s.t("commandShow"), () => void this.activateView());
    this.addSettingTab(new WaslSettingTab(this.app, this));
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
    await this.saveData(this.settings);
    this.applyLanguage();
    this.refreshViews(opts.rescan ?? false);
  }

  /** الإعدادات تغيّرت من خارج التطبيق (المزامنة). */
  override async onExternalSettingsChange(): Promise<void> {
    const before = this.settings.excludedFolders.join("\n");
    this.settings = readSettings(await this.loadData());
    this.applyLanguage();
    this.refreshViews(before !== this.settings.excludedFolders.join("\n"));
  }

  private refreshViews(rescan: boolean): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof MentionsView) leaf.view.settingsChanged(rescan);
    }
  }
}
