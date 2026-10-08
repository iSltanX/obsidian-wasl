import { moment, Plugin } from "obsidian";
import { resolveLang, strings, type Strings } from "./i18n";
import { WaslSettingTab } from "./settings-tab";
import { DEFAULT_SETTINGS, readSettings, type WaslSettings } from "./settings";

/**
 * وصل: اكتشاف الإشارات العربية غير المربوطة.
 * المرحلة ٢: الإعدادات أولًا؛ اللوحة تأتي في خطوة لاحقة.
 */
export default class WaslPlugin extends Plugin {
  override settings: WaslSettings = { ...DEFAULT_SETTINGS };
  s: Strings = strings("en");

  override async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.applyLanguage();

    this.addSettingTab(new WaslSettingTab(this.app, this));
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

  private refreshViews(_rescan: boolean): void {
    // اللوحة تأتي في الخطوة ٢.٣
  }
}
