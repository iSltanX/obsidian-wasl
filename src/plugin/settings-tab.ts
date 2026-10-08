import { PluginSettingTab, Setting, type App } from "obsidian";
import type WaslPlugin from "./main";
import { parseFolderList, type LanguageSetting, type PossibleMode, type QuoteMode } from "./settings";

/** صفحة الإعدادات (docs/ui.md، البند ٨). كل تغيير يُحفظ فورًا وتُحدَّث اللوحة. */
export class WaslSettingTab extends PluginSettingTab {
  /** يحفظ حقل المجلدات المستثناة؛ يُستدعى عند مغادرته وعند إغلاق الإعدادات. */
  private flushFolders: (() => void) | null = null;

  constructor(
    app: App,
    private readonly plugin: WaslPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.s;
    const settings = this.plugin.settings;
    containerEl.empty();
    containerEl.addClass("wasl-settings");
    containerEl.dir = s.lang === "ar" ? "rtl" : "ltr";

    new Setting(containerEl)
      .setName(s.t("setExcluded"))
      .setDesc(s.t("setExcludedDesc"))
      .addTextArea((text) => {
        text.setValue(settings.excludedFolders.join("\n"));
        text.inputEl.rows = 4;
        text.inputEl.dir = "auto";
        // الحفظ عند مغادرة الحقل أو إغلاق الإعدادات: الكتابة حرفًا حرفًا لا تعيد البحث مع كل حرف
        this.flushFolders = () => {
          const folders = parseFolderList(text.getValue());
          if (folders.join("\n") === settings.excludedFolders.join("\n")) return;
          settings.excludedFolders = folders;
          void this.plugin.saveSettings({ rescan: true });
        };
        text.inputEl.addEventListener("blur", () => this.flushFolders?.());
      });

    new Setting(containerEl)
      .setName(s.t("setPossible"))
      .setDesc(s.t("setPossibleDesc"))
      .addDropdown((d) =>
        d
          .addOption("collapsed", s.t("setPossibleCollapsed"))
          .addOption("hidden", s.t("setPossibleHidden"))
          .setValue(settings.possible)
          .onChange((v) => {
            settings.possible = v as PossibleMode;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(s.t("setQuotes"))
      .setDesc(s.t("setQuotesDesc"))
      .addDropdown((d) =>
        d
          .addOption("tagged", s.t("setQuotesTagged"))
          .addOption("hidden", s.t("setQuotesHidden"))
          .setValue(settings.quotes)
          .onChange((v) => {
            settings.quotes = v as QuoteMode;
            void this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(s.t("setFirst"))
      .setDesc(s.t("setFirstDesc"))
      .addToggle((t) =>
        t.setValue(settings.firstMentionOnly).onChange((v) => {
          settings.firstMentionOnly = v;
          void this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(s.t("setLanguage"))
      .setDesc(s.t("setLanguageDesc"))
      .addDropdown((d) =>
        d
          .addOption("auto", s.t("setLanguageAuto"))
          .addOption("ar", "العربية")
          .addOption("en", "English")
          .setValue(settings.language)
          .onChange(async (v) => {
            settings.language = v as LanguageSetting;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl).setName(s.t("setPropertyHeading")).setHeading();
    const help = containerEl.createDiv({ cls: "wasl-settings-help" });
    help.createEl("p", { text: s.t("setPropertyDesc") });
    const list = help.createEl("ul");
    for (const [value, key] of [
      ["exact", "setPropertyExact"],
      ["indefinite", "setPropertyIndefinite"],
    ] as const) {
      const li = list.createEl("li");
      li.createEl("code", { text: `wasl: ${value}`, attr: { dir: "ltr" } });
      li.appendText(" ");
      li.createSpan({ text: s.t(key) });
    }
  }

  override hide(): void {
    this.flushFolders?.();
    super.hide();
  }
}
