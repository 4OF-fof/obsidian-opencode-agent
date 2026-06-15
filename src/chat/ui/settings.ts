import { App, PluginSettingTab, setIcon, Setting } from "obsidian";
import OpenCodeChatPlugin from "../plugin";
import { ReasoningEffort } from "../shared/types";
import { effortLabel, formatError, selectedModelValue, updateEffortFavorite, updateStringFavorite } from "./helpers";

export class OpenCodeChatSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: OpenCodeChatPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OpenCode Chat" });

    const selectedModel = `${this.plugin.settings.providerID}/${this.plugin.settings.modelID}`;

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Only models from connected opencode providers are shown.")
      .addButton((button) =>
        button.setButtonText("Reload").onClick(async () => {
          this.plugin.resetServer();
          await this.plugin.refreshModels();
          this.display();
        }),
      )
      .addDropdown(async (dropdown) => {
        dropdown.addOption("", "Use opencode default model");
        dropdown.setValue(selectedModel === "/" ? "" : selectedModel);

        try {
          const models = await this.plugin.listModels();
          for (const model of models) {
            dropdown.addOption(`${model.providerID}/${model.modelID}`, model.label);
          }
          dropdown.setValue(selectedModel === "/" ? "" : selectedModel);
        } catch {
          if (selectedModel !== "/") {
            dropdown.addOption(selectedModel, selectedModel);
            dropdown.setValue(selectedModel);
          }
        }

        dropdown.onChange(async (value) => {
          const separator = value.indexOf("/");
          this.plugin.settings.providerID = separator >= 0 ? value.slice(0, separator) : "";
          this.plugin.settings.modelID = separator >= 0 ? value.slice(separator + 1) : "";
          await this.plugin.saveSettings();
        });
      });

    this.renderFavoriteModelSettings(containerEl);
    this.renderFavoriteEffortSettings(containerEl);
  }

  private renderFavoriteModelSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Favorite chat models")
      .setDesc("Favorites appear at the top of the chat model selector.")
      .addButton((button) =>
        button.setButtonText("Reload").onClick(async () => {
          this.plugin.resetServer();
          await this.plugin.refreshModels();
          this.display();
        }),
      );

    const listEl = containerEl.createDiv({ cls: "opencode-chat-settings-list" });
    listEl.createDiv({ cls: "opencode-chat-settings-loading", text: "Loading models..." });
    void this.populateFavoriteModelSettings(listEl);
  }

  private async populateFavoriteModelSettings(listEl: HTMLElement): Promise<void> {
    listEl.empty();

    try {
      const models = await this.plugin.listModels();
      if (models.length === 0) {
        listEl.createDiv({ cls: "opencode-chat-settings-empty", text: "No connected models found." });
        return;
      }

      this.renderFavoritePicker(listEl, models.map((model) => ({
        label: model.label,
        value: selectedModelValue(model.providerID, model.modelID),
      })), this.plugin.settings.visibleModelIDs, async (value, enabled) => {
        this.plugin.settings.visibleModelIDs = updateStringFavorite(this.plugin.settings.visibleModelIDs, value, enabled);
        await this.plugin.saveSettings();
      });
    } catch (error) {
      listEl.createDiv({
        cls: "opencode-chat-settings-empty",
        text: `Unable to load models: ${formatError(error)}`,
      });
    }
  }

  private renderFavoriteEffortSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Favorite chat efforts")
      .setDesc("Favorites are saved per model and appear at the top of the chat effort selector.")
      .addButton((button) =>
        button.setButtonText("Reload").onClick(async () => {
          this.plugin.resetServer();
          await this.plugin.refreshModels();
          this.display();
        }),
      );

    const listEl = containerEl.createDiv({ cls: "opencode-chat-settings-list" });
    listEl.createDiv({ cls: "opencode-chat-settings-loading", text: "Loading model efforts..." });
    void this.populateFavoriteEffortSettings(listEl);
  }

  private async populateFavoriteEffortSettings(listEl: HTMLElement): Promise<void> {
    listEl.empty();

    try {
      const models = (await this.plugin.listModels()).filter((model) => model.effortOptions.length > 0);
      if (models.length === 0) {
        listEl.createDiv({ cls: "opencode-chat-settings-empty", text: "No model-specific effort options found." });
        return;
      }

      for (const model of models) {
        const modelValue = selectedModelValue(model.providerID, model.modelID);
        listEl.createDiv({ cls: "opencode-chat-settings-subheading", text: model.label });
        this.renderFavoritePicker(
          listEl,
          model.effortOptions.map((effort) => ({ label: effortLabel(effort), value: effort })),
          this.favoriteEffortsForModel(modelValue),
          async (value, enabled) => {
            this.setFavoriteEffortsForModel(
              modelValue,
              updateEffortFavorite(this.favoriteEffortsForModel(modelValue), value, enabled),
            );
            await this.plugin.saveSettings();
          },
        );
      }
    } catch (error) {
      listEl.createDiv({
        cls: "opencode-chat-settings-empty",
        text: `Unable to load model efforts: ${formatError(error)}`,
      });
    }
  }

  private favoriteEffortsForModel(modelValue: string): ReasoningEffort[] {
    return this.plugin.settings.favoriteReasoningEffortsByModel[modelValue] ?? [];
  }

  private setFavoriteEffortsForModel(modelValue: string, values: ReasoningEffort[]): void {
    if (values.length === 0) {
      delete this.plugin.settings.favoriteReasoningEffortsByModel[modelValue];
      return;
    }

    this.plugin.settings.favoriteReasoningEffortsByModel[modelValue] = values;
  }

  private renderFavoritePicker(
    containerEl: HTMLElement,
    options: Array<{ label: string; value: string }>,
    favoriteValues: string[],
    onToggleFavorite: (value: string, enabled: boolean) => Promise<void>,
  ): void {
    const menuEl = containerEl.createDiv({ cls: "opencode-chat-picker-menu opencode-chat-settings-picker" });
    const favoriteSet = new Set(favoriteValues);
    const favoriteOptions = options.filter((option) => favoriteSet.has(option.value));
    const allOptions = options.filter((option) => !favoriteSet.has(option.value));

    if (favoriteOptions.length > 0) {
      this.renderFavoritePickerSection(menuEl, "Favorites", favoriteOptions, favoriteValues, onToggleFavorite);
    }
    if (allOptions.length > 0) {
      this.renderFavoritePickerSection(menuEl, "All Options", allOptions, favoriteValues, onToggleFavorite);
    }
  }

  private renderFavoritePickerSection(
    menuEl: HTMLElement,
    title: string,
    options: Array<{ label: string; value: string }>,
    favoriteValues: string[],
    onToggleFavorite: (value: string, enabled: boolean) => Promise<void>,
  ): void {
    menuEl.createDiv({ cls: "opencode-chat-picker-section", text: title });

    for (const option of options) {
      const itemEl = menuEl.createDiv({ cls: "opencode-chat-picker-item" });
      itemEl.createSpan({ cls: "opencode-chat-picker-item-label", text: option.label });
      itemEl.createSpan({ cls: "opencode-chat-picker-item-icon is-empty" });

      const favoriteButtonEl = itemEl.createEl("button", {
        cls: "opencode-chat-picker-favorite",
        attr: { type: "button", "aria-label": "Toggle favorite" },
      });
      const isFavorite = favoriteValues.includes(option.value);
      setIcon(favoriteButtonEl, "star");
      favoriteButtonEl.toggleClass("is-favorite", isFavorite);
      favoriteButtonEl.addEventListener("click", async () => {
        await onToggleFavorite(option.value, !isFavorite);
        this.display();
      });
    }
  }
}
