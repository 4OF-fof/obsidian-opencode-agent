import { ItemView, MarkdownRenderer, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { ChatMessage, ChatMessageDetail, ReasoningEffort } from "../shared/types";
import OpenCodeChatPlugin from "../plugin/plugin";
import { effortLabel, formatError, selectedModelValue, updateEffortFavorite, updateStringFavorite } from "./helpers";

export const VIEW_TYPE_OPENCODE_CHAT = "opencode-chat-view";

export class OpenCodeChatView extends ItemView {
  private historyEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButtonEl!: HTMLButtonElement;
  private modelPickerButtonEl!: HTMLButtonElement;
  private effortPickerButtonEl!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private activePickerMenuEl: HTMLElement | null = null;
  private activePickerParentEl: HTMLElement | null = null;
  private modelOptions: PickerOption[] = [];
  private messages: ChatMessage[] = [];
  private pending = false;
  private activeRequest: ActiveChatRequest | null = null;
  private nextRequestId = 1;
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (this.activePickerMenuEl?.contains(target) || this.activePickerParentEl?.contains(target)) {
      return;
    }

    this.closePickerMenu();
  };

  constructor(leaf: WorkspaceLeaf, private readonly plugin: OpenCodeChatPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_OPENCODE_CHAT;
  }

  getDisplayText(): string {
    return "OpenCode Chat";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("opencode-chat-view");

    this.statusEl = container.createDiv({ cls: "opencode-chat-status" });
    this.historyEl = container.createDiv({ cls: "opencode-chat-history" });

    const composerEl = container.createDiv({ cls: "opencode-chat-composer" });
    this.inputEl = composerEl.createEl("textarea", {
      cls: "opencode-chat-input",
      attr: { placeholder: "Message opencode..." },
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.submit();
      }
    });

    const controlsEl = composerEl.createDiv({ cls: "opencode-chat-controls" });
    const selectorGroupEl = controlsEl.createDiv({ cls: "opencode-chat-selectors" });

    const modelPickerEl = selectorGroupEl.createDiv({ cls: "opencode-chat-picker-wrap opencode-chat-model-picker-wrap" });
    this.modelPickerButtonEl = modelPickerEl.createEl("button", {
      cls: "opencode-chat-picker opencode-chat-model-picker",
      attr: { "aria-label": "Model", type: "button" },
    });
    this.modelPickerButtonEl.addEventListener("click", () => {
      this.openPickerMenu(modelPickerEl, {
        kind: "model",
        options: this.modelOptions,
        selectedValue: selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID),
        favoriteValues: this.plugin.settings.visibleModelIDs,
        allowFavorite: () => true,
        onSelect: async (value) => {
          const separator = value.indexOf("/");
          this.plugin.settings.providerID = separator >= 0 ? value.slice(0, separator) : "";
          this.plugin.settings.modelID = separator >= 0 ? value.slice(separator + 1) : "";
          this.normalizeSelectedEffort();
          await this.plugin.saveSettings();
          this.updatePickerLabels();
        },
        onToggleFavorite: async (value, enabled) => {
          this.plugin.settings.visibleModelIDs = updateStringFavorite(this.plugin.settings.visibleModelIDs, value, enabled);
          await this.plugin.saveSettings();
        },
      });
    });

    const effortPickerEl = selectorGroupEl.createDiv({ cls: "opencode-chat-picker-wrap opencode-chat-effort-picker-wrap" });
    this.effortPickerButtonEl = effortPickerEl.createEl("button", {
      cls: "opencode-chat-picker opencode-chat-effort-picker",
      attr: { "aria-label": "Effort", type: "button" },
    });
    this.effortPickerButtonEl.addEventListener("click", () => {
      const effortOptions = this.currentEffortOptions();
      const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
      this.openPickerMenu(effortPickerEl, {
        kind: "effort",
        options: effortOptions.map((value) => ({ value, label: effortLabel(value) })),
        selectedValue: this.plugin.settings.reasoningEffort,
        favoriteValues: this.favoriteEffortsForModel(selectedModel),
        allowFavorite: () => true,
        onSelect: async (value) => {
          this.plugin.settings.reasoningEffort = value as ReasoningEffort;
          await this.plugin.saveSettings();
          this.updatePickerLabels();
        },
        onToggleFavorite: async (value, enabled) => {
          this.setFavoriteEffortsForModel(
            selectedModel,
            updateEffortFavorite(this.favoriteEffortsForModel(selectedModel), value as ReasoningEffort, enabled),
          );
          await this.plugin.saveSettings();
        },
      });
    });

    this.sendButtonEl = controlsEl.createEl("button", {
      cls: "opencode-chat-send",
      attr: { "aria-label": "Send message", title: "Send" },
    });
    setIcon(this.sendButtonEl, "send-horizontal");
    this.sendButtonEl.addEventListener("click", () => {
      if (this.pending) {
        this.interruptCurrentRequest();
        return;
      }

      void this.submit();
    });
    this.renderMessages();
    this.updatePickerLabels();
    void this.populateModelSelect();
  }

  async onClose(): Promise<void> {
    this.closePickerMenu();
    this.containerEl.empty();
  }

  private async submit(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.pending) {
      return;
    }

    this.pending = true;
    const activeRequest: ActiveChatRequest = {
      id: this.nextRequestId++,
      interrupted: false,
    };
    this.activeRequest = activeRequest;
    this.inputEl.value = "";
    this.messages.push({ role: "user", text });
    const assistantMessage: ChatMessage = { role: "assistant", text: "", details: [] };
    this.messages.push(assistantMessage);
    this.renderMessages();
    this.setStatus("Waiting for opencode...");
    this.updateControls();

    try {
      const updateAssistantMessage = (response: { text: string; details: ChatMessageDetail[] }): void => {
        if (!this.isCurrentRequest(activeRequest)) {
          return;
        }

        assistantMessage.text = response.text;
        assistantMessage.details = response.details;
        this.renderMessages();
      };
      const response = await this.plugin.sendChatMessage(text, updateAssistantMessage);
      if (!this.isCurrentRequest(activeRequest)) {
        return;
      }

      assistantMessage.text = response.text;
      assistantMessage.details = response.details;
      this.setStatus("");
    } catch (error) {
      if (!this.isCurrentRequest(activeRequest)) {
        return;
      }

      const message = formatError(error);
      assistantMessage.role = "error";
      assistantMessage.text = message;
      assistantMessage.details = [];
      this.setStatus("Request failed.");
      new Notice(`OpenCode request failed: ${message}`);
    } finally {
      if (this.activeRequest?.id === activeRequest.id) {
        this.pending = false;
        this.activeRequest = null;
        this.renderMessages();
        this.updateControls();
        this.inputEl.focus();
      }
    }
  }

  private renderMessages(): void {
    this.historyEl.empty();

    if (this.messages.length === 0) {
      this.historyEl.createDiv({
        cls: "opencode-chat-empty",
        text: "No messages yet.",
      });
      return;
    }

    const lastAssistantMessage = [...this.messages].reverse().find((message) => message.role === "assistant");

    for (const message of this.messages) {
      const isActiveAssistantMessage = this.pending && message === this.messages[this.messages.length - 1];
      const messageEl = this.historyEl.createDiv({
        cls: `opencode-chat-message opencode-chat-message-${message.role}`,
      });
      if (message.role === "assistant" && message.details && message.details.length > 0) {
        this.renderMessageDetails(
          messageEl,
          message.details,
          !message.text && (isActiveAssistantMessage || message === lastAssistantMessage),
        );
      }

      if (message.text) {
        this.renderMessageText(messageEl, message);
      }
    }

    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private updateControls(): void {
    this.inputEl.disabled = this.pending;
    this.sendButtonEl.disabled = false;
    this.modelPickerButtonEl.disabled = this.pending;
    this.effortPickerButtonEl.disabled = this.pending;
    this.sendButtonEl.setAttribute("aria-label", this.pending ? "Stop response" : "Send message");
    this.sendButtonEl.setAttribute("title", this.pending ? "Stop" : "Send");
    this.sendButtonEl.empty();
    setIcon(this.sendButtonEl, this.pending ? "square" : "send-horizontal");
    if (this.pending) {
      this.closePickerMenu();
    }
  }

  private interruptCurrentRequest(): void {
    if (!this.activeRequest) {
      return;
    }

    this.activeRequest.interrupted = true;
    this.activeRequest = null;
    this.pending = false;
    this.plugin.resetSession();
    this.setStatus("Request interrupted.");
    this.renderMessages();
    this.updateControls();
    this.inputEl.focus();
  }

  private isCurrentRequest(request: ActiveChatRequest): boolean {
    return this.activeRequest?.id === request.id && !request.interrupted;
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private renderMessageText(parentEl: HTMLElement, message: ChatMessage): void {
    if (message.role === "assistant") {
      const textEl = parentEl.createDiv({ cls: "opencode-chat-message-text opencode-chat-message-markdown markdown-rendered" });
      void MarkdownRenderer.renderMarkdown(message.text, textEl, "", this).catch(() => {
        textEl.setText(message.text);
      });
      return;
    }

    parentEl.createEl("pre", {
      cls: "opencode-chat-message-text",
      text: message.text,
    });
  }

  private renderMessageDetails(parentEl: HTMLElement, details: ChatMessageDetail[], openLastDetail: boolean): void {
    details.forEach((detail, index) => {
      const detailEl = parentEl.createEl("details", {
        cls: `opencode-chat-detail opencode-chat-detail-${detail.kind}`,
      }) as HTMLDetailsElement;
      detailEl.open = openLastDetail && index === details.length - 1;
      detailEl.createEl("summary", {
        cls: "opencode-chat-detail-summary",
      });
      this.renderDetailSummary(detailEl, detail);
      if (detail.text) {
        detailEl.createEl("pre", {
          cls: "opencode-chat-detail-text",
          text: detail.text,
        });
      }
    });
  }

  private renderDetailSummary(detailEl: HTMLElement, detail: ChatMessageDetail): void {
    const summaryEl = detailEl.querySelector(".opencode-chat-detail-summary");
    if (!(summaryEl instanceof HTMLElement)) {
      return;
    }

    const iconEl = summaryEl.createSpan({ cls: "opencode-chat-detail-icon" });
    setIcon(iconEl, detail.kind === "tool" ? "arrow-right" : "lightbulb");
    summaryEl.createSpan({
      cls: "opencode-chat-detail-title",
      text: detail.kind === "reasoning" ? "Thinking" : detail.title,
    });
  }

  private async populateModelSelect(): Promise<void> {
    const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
    this.modelOptions = [];

    try {
      const models = await this.plugin.listModels();
      const seen = new Set<string>();
      const nextOptions: PickerOption[] = [];
      for (const model of models) {
        const value = selectedModelValue(model.providerID, model.modelID);
        if (seen.has(value)) {
          continue;
        }
        seen.add(value);
        nextOptions.push({ value, label: model.label, effortOptions: model.effortOptions });
      }
      this.modelOptions = nextOptions;
      if (selectedModel && !seen.has(selectedModel)) {
        this.plugin.settings.providerID = "";
        this.plugin.settings.modelID = "";
        this.plugin.settings.reasoningEffort = "";
        void this.plugin.saveSettings();
      }
    } catch (error) {
      this.modelOptions = selectedModel
        ? [{ value: selectedModel, label: selectedModel, effortOptions: [] }]
        : [];
      this.setStatus(`Unable to load models: ${formatError(error)}`);
    }

    this.normalizeSelectedEffort();
    this.updatePickerLabels();
  }

  private updatePickerLabels(): void {
    const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
    const selectedModelOption = this.modelOptions.find((option) => option.value === selectedModel);
    this.setPickerButtonContent(this.modelPickerButtonEl, selectedModelOption?.label ?? "Select model");

    const effortOptions = this.currentEffortOptions();
    this.effortPickerButtonEl.toggleClass("is-hidden", effortOptions.length === 0);
    if (effortOptions.length === 0) {
      this.plugin.settings.reasoningEffort = "";
      return;
    }

    this.normalizeSelectedEffort();
    this.setPickerButtonContent(this.effortPickerButtonEl, effortLabel(this.plugin.settings.reasoningEffort));
  }

  private setPickerButtonContent(buttonEl: HTMLButtonElement, label: string): void {
    buttonEl.empty();
    buttonEl.createSpan({ cls: "opencode-chat-picker-label", text: label });
    const iconEl = buttonEl.createSpan({ cls: "opencode-chat-picker-chevron" });
    setIcon(iconEl, "chevron-down");
  }

  private openPickerMenu(parentEl: HTMLElement, config: PickerMenuConfig): void {
    if (this.activePickerMenuEl?.parentElement === parentEl) {
      this.closePickerMenu();
      return;
    }

    this.closePickerMenu();

    const menuEl = parentEl.createDiv({ cls: "opencode-chat-picker-menu" });
    this.activePickerMenuEl = menuEl;
    this.activePickerParentEl = parentEl;
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.renderPickerMenuContents(menuEl, config);
  }

  private renderPickerMenuContents(menuEl: HTMLElement, config: PickerMenuConfig): void {
    menuEl.empty();
    const favoriteValues = new Set(config.favoriteValues);
    const favoriteOptions = sortSelectedFirst(
      config.options.filter((option) => favoriteValues.has(option.value)),
      config.selectedValue,
    );
    const allOptions = sortSelectedFirst(
      config.options.filter((option) => !favoriteValues.has(option.value)),
      config.selectedValue,
    );

    if (favoriteOptions.length > 0) {
      this.renderPickerSection(menuEl, "Favorites", favoriteOptions, config);
    }

    if (allOptions.length > 0) {
      this.renderPickerSection(menuEl, "All Options", allOptions, config);
    }
  }

  private renderPickerSection(
    menuEl: HTMLElement,
    title: string,
    options: PickerOption[],
    config: PickerMenuConfig,
  ): void {
    if (title) {
      menuEl.createDiv({ cls: "opencode-chat-picker-section", text: title });
    }

    for (const option of options) {
      const itemEl = menuEl.createDiv({
        cls: "opencode-chat-picker-item",
        attr: { role: "button", tabindex: "0" },
      });
      itemEl.createSpan({ cls: "opencode-chat-picker-item-label", text: option.label });

      const selectedIconEl = itemEl.createSpan({ cls: "opencode-chat-picker-item-icon" });
      if (option.value === config.selectedValue) {
        setIcon(selectedIconEl, "check");
      } else {
        selectedIconEl.addClass("is-empty");
      }

      if (config.allowFavorite(option.value)) {
        const favoriteButtonEl = itemEl.createEl("button", {
          cls: "opencode-chat-picker-favorite",
          attr: { type: "button", "aria-label": "Toggle favorite" },
        });
        setIcon(favoriteButtonEl, config.favoriteValues.includes(option.value) ? "star" : "star");
        favoriteButtonEl.toggleClass("is-favorite", config.favoriteValues.includes(option.value));
        favoriteButtonEl.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await config.onToggleFavorite(option.value, !config.favoriteValues.includes(option.value));
          this.renderPickerMenuContents(menuEl, {
            ...config,
            favoriteValues: this.currentFavoriteValuesFor(config),
          });
        });
      } else {
        itemEl.createSpan({ cls: "opencode-chat-picker-favorite-placeholder" });
      }

      itemEl.addEventListener("click", async () => {
        await config.onSelect(option.value);
        this.closePickerMenu();
      });
      itemEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        void config.onSelect(option.value).then(() => this.closePickerMenu());
      });
    }
  }

  private currentFavoriteValuesFor(config: PickerMenuConfig): string[] {
    if (config.kind === "model") {
      return this.plugin.settings.visibleModelIDs;
    }

    const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
    return this.favoriteEffortsForModel(selectedModel);
  }

  private closePickerMenu(): void {
    this.activePickerMenuEl?.remove();
    this.activePickerMenuEl = null;
    this.activePickerParentEl = null;
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  private currentEffortOptions(): ReasoningEffort[] {
    const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
    const selectedModelOption = this.modelOptions.find((option) => option.value === selectedModel);
    return selectedModelOption?.effortOptions ?? [];
  }

  private normalizeSelectedEffort(): void {
    const effortOptions = this.currentEffortOptions();
    if (effortOptions.length === 0) {
      this.plugin.settings.reasoningEffort = "";
      return;
    }

    if (!effortOptions.includes(this.plugin.settings.reasoningEffort)) {
      const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
      const favoriteEffort = this.favoriteEffortsForModel(selectedModel).find((effort) => effortOptions.includes(effort));
      this.plugin.settings.reasoningEffort = favoriteEffort ?? effortOptions[0];
    }
  }

  private favoriteEffortsForModel(modelValue: string): ReasoningEffort[] {
    if (!modelValue) {
      return [];
    }

    return this.plugin.settings.favoriteReasoningEffortsByModel[modelValue] ?? [];
  }

  private setFavoriteEffortsForModel(modelValue: string, values: ReasoningEffort[]): void {
    if (!modelValue) {
      return;
    }

    if (values.length === 0) {
      delete this.plugin.settings.favoriteReasoningEffortsByModel[modelValue];
      return;
    }

    this.plugin.settings.favoriteReasoningEffortsByModel[modelValue] = values;
  }
}

interface PickerOption {
  value: string;
  label: string;
  effortOptions?: ReasoningEffort[];
}

interface ActiveChatRequest {
  id: number;
  interrupted: boolean;
}

interface PickerMenuConfig {
  kind: "model" | "effort";
  options: PickerOption[];
  selectedValue: string;
  favoriteValues: string[];
  allowFavorite: (value: string) => boolean;
  onSelect: (value: string) => Promise<void>;
  onToggleFavorite: (value: string, enabled: boolean) => Promise<void>;
}

function sortSelectedFirst(options: PickerOption[], selectedValue: string): PickerOption[] {
  if (!selectedValue) {
    return options;
  }

  return [...options].sort((a, b) => {
    if (a.value === selectedValue) {
      return -1;
    }
    if (b.value === selectedValue) {
      return 1;
    }
    return 0;
  });
}
