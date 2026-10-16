import { debounce, PluginSettingTab, requireApiVersion, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type WaslPlugin from "./main";
import { parseFolderList, type LanguageSetting, type PossibleMode, type QuoteMode } from "./settings";

/**
 * صفحة الإعدادات (docs/ui.md، البند ٨). كل تغيير يُحفظ فورًا وتُحدَّث اللوحة.
 * مساران: `getSettingDefinitions()` لـObsidian 1.13 فأحدث (تظهر الإعدادات في بحث الإعدادات)، و`display()`
 * للأقدم حتى 1.7.2. يختار Obsidian أحدهما؛ ولا يُستدعى `display()` حين تُرجع التعريفات شيئًا.
 */
export class WaslSettingTab extends PluginSettingTab {
  /** يحفظ حقل المجلدات المستثناة؛ يُستدعى عند مغادرته وعند إغلاق الإعدادات. */
  private flushFolders: (() => void) | null = null;
  /** نص المجلدات المستثناة المنتظر الحفظ في المسار التعريفي. */
  private pendingFolders: string | null = null;
  private readonly saveFoldersSoon = debounce(() => this.commitFolders(), 700, true);

  constructor(
    app: App,
    private readonly plugin: WaslPlugin,
  ) {
    super(app, plugin);
  }

  /** تحديث الروابط التلقائي ليس في الواجهة العامة؛ إن غاب `getConfig` لا يظهر التنبيه. */
  private updateLinksOff(): boolean {
    const vault = this.app.vault as unknown as { getConfig?: (key: string) => unknown };
    return typeof vault.getConfig === "function" && vault.getConfig("alwaysUpdateLinks") === false;
  }

  /** الكتابة حرفًا حرفًا لا تعيد البحث مع كل حرف: يُحفظ بعد توقف قصير وعند إغلاق الإعدادات. */
  private commitFolders(): void {
    if (this.pendingFolders === null) return;
    const folders = parseFolderList(this.pendingFolders);
    this.pendingFolders = null;
    const settings = this.plugin.settings;
    if (folders.join("\n") === settings.excludedFolders.join("\n")) return;
    settings.excludedFolders = folders;
    void this.plugin.saveSettings({ rescan: true });
  }

  /**
   * إعادة رسم كاملة في المسار التعريفي بعد تبديل اللغة: `update()` وحدها تجدّد الصفوف إلا صفّ الحقل النصي
   * (المجلدات المستثناة) فيبقى بلغته القديمة. رسم التبويب الأصلي بعد `update()` يجدّدها كلها.
   */
  private redraw(): void {
    // المسار التعريفي لا يُستعمل قبل 1.13، فلا شيء يُعاد رسمه هناك
    if (requireApiVersion("1.13.0")) {
      this.update();
      this.containerEl.empty();
      super.display();
    }
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.s;
    this.containerEl.addClass("wasl-settings");
    this.containerEl.dir = s.lang === "ar" ? "rtl" : "ltr";
    return [
      {
        name: s.t("updateLinksOff"),
        searchable: false,
        visible: () => this.updateLinksOff(),
        render: (setting) => {
          setting.settingEl.empty();
          setting.settingEl.addClass("wasl-settings-warning");
          setting.settingEl.setText(s.t("updateLinksOff"));
        },
      },
      { name: s.t("setExcluded"), desc: s.t("setExcludedDesc"), control: { type: "textarea", key: "excludedFolders", rows: 4 } },
      {
        name: s.t("setPossible"),
        desc: s.t("setPossibleDesc"),
        control: { type: "dropdown", key: "possible", options: { collapsed: s.t("setPossibleCollapsed"), hidden: s.t("setPossibleHidden") } },
      },
      {
        name: s.t("setQuotes"),
        desc: s.t("setQuotesDesc"),
        control: { type: "dropdown", key: "quotes", options: { tagged: s.t("setQuotesTagged"), hidden: s.t("setQuotesHidden") } },
      },
      { name: s.t("setFirst"), desc: s.t("setFirstDesc"), control: { type: "toggle", key: "firstMentionOnly" } },
      {
        name: s.t("setLanguage"),
        desc: s.t("setLanguageDesc"),
        control: { type: "dropdown", key: "language", options: { auto: s.t("setLanguageAuto"), ar: "العربية", en: "English" } },
      },
      {
        type: "group",
        heading: s.t("setStats"),
        items: [{ name: s.t("setStatsButton"), desc: s.t("setStatsDesc"), aliases: [s.t("setStats")], action: () => void this.plugin.exportStats() }],
      },
      {
        type: "group",
        heading: s.t("setPropertyHeading"),
        items: [
          { name: s.t("setPropertyDesc") },
          { name: "wasl: exact", desc: s.t("setPropertyExact") },
          { name: "wasl: indefinite", desc: s.t("setPropertyIndefinite") },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    const settings = this.plugin.settings;
    switch (key) {
      case "excludedFolders":
        return settings.excludedFolders.join("\n");
      case "possible":
        return settings.possible;
      case "quotes":
        return settings.quotes;
      case "firstMentionOnly":
        return settings.firstMentionOnly;
      case "language":
        return settings.language;
      default:
        return undefined;
    }
  }

  override setControlValue(key: string, value: unknown): void | Promise<void> {
    const settings = this.plugin.settings;
    switch (key) {
      case "excludedFolders":
        this.pendingFolders = typeof value === "string" ? value : "";
        this.saveFoldersSoon();
        return;
      case "possible":
        settings.possible = (value === "hidden" ? "hidden" : "collapsed") satisfies PossibleMode;
        break;
      case "quotes":
        settings.quotes = (value === "hidden" ? "hidden" : "tagged") satisfies QuoteMode;
        break;
      case "firstMentionOnly":
        settings.firstMentionOnly = value === true;
        break;
      case "language":
        settings.language = (value === "ar" || value === "en" ? value : "auto") satisfies LanguageSetting;
        return this.plugin.saveSettings().then(() => this.redraw());
      default:
        return;
    }
    return this.plugin.saveSettings();
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.plugin.s;
    const settings = this.plugin.settings;
    containerEl.empty();
    containerEl.addClass("wasl-settings");
    containerEl.dir = s.lang === "ar" ? "rtl" : "ltr";

    if (this.updateLinksOff()) containerEl.createDiv({ cls: "wasl-settings-warning", text: s.t("updateLinksOff") });

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

    new Setting(containerEl)
      .setName(s.t("setStats"))
      .setDesc(s.t("setStatsDesc"))
      .addButton((b) => b.setButtonText(s.t("setStatsButton")).onClick(() => void this.plugin.exportStats()));

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
    this.saveFoldersSoon.cancel();
    this.commitFolders();
    super.hide();
  }
}
