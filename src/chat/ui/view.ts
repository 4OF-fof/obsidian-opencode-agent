import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import {
  ChatMessage,
  ChatMessageBlock,
  ChatMessageDetail,
  OpenCodeQuestionAnswer,
  OpenCodeQuestionRequest,
  OpenCodeQuestionResolution,
  OpenCodeSessionOption,
  ReasoningEffort,
} from "../shared/types";
import OpenCodeChatPlugin from "../plugin";
import { effortLabel, formatError, selectedModelValue, updateEffortFavorite, updateStringFavorite } from "./helpers";
import { renderMessageBlocks, renderMessageDetails, renderMessageText } from "./message-renderer";
import { renderPickerMenuContents, setPickerButtonContent } from "./picker-menu";
import {
  renderSessionHistory,
  updateSelectedSessionHistoryItem,
} from "./session-history";
import {
  ActiveChatRequest,
  ActiveQuestion,
  DEFAULT_INPUT_PLACEHOLDER,
  PickerMenuConfig,
  PickerOption,
} from "./view-types";
import { maxInputHeight } from "./view-utils";

export const VIEW_TYPE_OPENCODE_CHAT = "opencode-chat-view";

export class OpenCodeChatView extends ItemView {
  private historyEl!: HTMLElement;
  private sessionHistoryEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private questionEl!: HTMLElement;
  private sendButtonEl!: HTMLButtonElement;
  private sessionHistoryButtonEl!: HTMLButtonElement;
  private sessionHistoryTitleEl!: HTMLElement;
  private sessionPickerWrapEl!: HTMLElement;
  private sessionPickerButtonEl!: HTMLButtonElement;
  private modelPickerButtonEl!: HTMLButtonElement;
  private effortPickerButtonEl!: HTMLButtonElement;
  private selectorGroupEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private activePickerMenuEl: HTMLElement | null = null;
  private activePickerParentEl: HTMLElement | null = null;
  private sessionList: OpenCodeSessionOption[] = [];
  private sessionOptions: PickerOption[] = [];
  private modelOptions: PickerOption[] = [];
  private messages: ChatMessage[] = [];
  private screen: "chat" | "sessions" = "chat";
  private pending = false;
  private activeRequest: ActiveChatRequest | null = null;
  private activeQuestion: ActiveQuestion | null = null;
  private unregisterSessionSelection: (() => void) | null = null;
  private inputCompositionActive = false;
  private ignoreNextEnterAfterComposition = false;
  private compositionEndTimer: number | null = null;
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

    const headerEl = container.createDiv({ cls: "opencode-chat-header" });
    this.sessionHistoryTitleEl = headerEl.createDiv({ cls: "opencode-chat-header-title is-hidden", text: "セッション履歴" });
    this.sessionPickerWrapEl = headerEl.createDiv({ cls: "opencode-chat-picker-wrap opencode-chat-session-picker-wrap" });
    this.sessionPickerButtonEl = this.sessionPickerWrapEl.createEl("button", {
      cls: "opencode-chat-picker opencode-chat-session-picker",
      attr: { "aria-label": "セッションを選択", title: "セッションを選択", type: "button" },
    });
    this.sessionPickerButtonEl.addEventListener("click", () => {
      this.openPickerMenu(this.sessionPickerWrapEl, {
        kind: "session",
        options: [{ value: "", label: "新規チャット" }, ...this.sessionOptions],
        selectedValue: this.plugin.currentSessionId(),
        favoriteValues: [],
        allowFavorite: () => false,
        onSelect: async (value) => {
          if (!value) {
            this.plugin.startNewSession();
            this.showChat();
            this.updatePickerLabels();
            return;
          }

          await this.plugin.selectSession(value);
          this.showChat();
          this.updatePickerLabels();
        },
        onToggleFavorite: async () => {},
      });
    });
    this.sessionHistoryButtonEl = headerEl.createEl("button", {
      cls: "opencode-chat-header-button",
      attr: { "aria-label": "セッション履歴を開く", type: "button" },
    });
    setIcon(this.sessionHistoryButtonEl, "history");
    this.sessionHistoryButtonEl.addEventListener("click", () => {
      void this.showSessionHistory();
    });

    this.statusEl = container.createDiv({ cls: "opencode-chat-status" });
    this.historyEl = container.createDiv({ cls: "opencode-chat-history" });
    this.sessionHistoryEl = container.createDiv({ cls: "opencode-session-history-list is-hidden" });

    this.composerEl = container.createDiv({ cls: "opencode-chat-composer" });
    this.questionEl = this.composerEl.createDiv({ cls: "opencode-chat-question is-hidden" });
    this.inputEl = this.composerEl.createEl("textarea", {
      cls: "opencode-chat-input",
      attr: { placeholder: DEFAULT_INPUT_PLACEHOLDER },
    });
    this.inputEl.addEventListener("compositionstart", () => {
      this.inputCompositionActive = true;
      this.ignoreNextEnterAfterComposition = false;
    });
    this.inputEl.addEventListener("compositionend", () => {
      this.inputCompositionActive = false;
      this.ignoreNextEnterAfterComposition = true;
      if (this.compositionEndTimer !== null) {
        window.clearTimeout(this.compositionEndTimer);
      }
      this.compositionEndTimer = window.setTimeout(() => {
        this.ignoreNextEnterAfterComposition = false;
        this.compositionEndTimer = null;
      }, 0);
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        if (
          event.isComposing ||
          event.keyCode === 229 ||
          this.inputCompositionActive ||
          this.ignoreNextEnterAfterComposition
        ) {
          return;
        }

        event.preventDefault();
        if (this.activeQuestion) {
          this.submitQuestionAnswer();
          return;
        }

        void this.submit();
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.updateActiveQuestionInput();
      this.resizeInput();
    });

    const controlsEl = this.composerEl.createDiv({ cls: "opencode-chat-controls" });
    const selectorGroupEl = controlsEl.createDiv({ cls: "opencode-chat-selectors" });
    this.selectorGroupEl = selectorGroupEl;

    const modelPickerEl = selectorGroupEl.createDiv({ cls: "opencode-chat-picker-wrap opencode-chat-model-picker-wrap" });
    this.modelPickerButtonEl = modelPickerEl.createEl("button", {
      cls: "opencode-chat-picker opencode-chat-model-picker",
      attr: { "aria-label": "モデル", type: "button" },
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
      attr: { "aria-label": "エフォート", type: "button" },
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
      attr: { "aria-label": "メッセージを送信", type: "button" },
    });
    setIcon(this.sendButtonEl, "send-horizontal");
    this.sendButtonEl.addEventListener("click", () => {
      if (this.activeQuestion) {
        this.submitQuestionAnswer();
        return;
      }

      if (this.pending) {
        this.interruptCurrentRequest();
        return;
      }

      void this.submit();
    });
    this.unregisterSessionSelection = this.plugin.onSessionSelectionChange((messages) => {
      this.messages = messages;
      this.renderMessages();
      this.updatePickerLabels();
      void this.populateSessionSelect();
    });
    this.messages = this.plugin.currentSessionMessages();
    this.renderMessages();
    this.updatePickerLabels();
    this.resizeInput();
    void this.populateSessionSelect();
    void this.populateModelSelect();
  }

  async onClose(): Promise<void> {
    if (this.compositionEndTimer !== null) {
      window.clearTimeout(this.compositionEndTimer);
      this.compositionEndTimer = null;
    }
    this.unregisterSessionSelection?.();
    this.unregisterSessionSelection = null;
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
    this.resizeInput();
    this.messages.push({ role: "user", text });
    const assistantMessage: ChatMessage = { role: "assistant", text: "", details: [] };
    this.messages.push(assistantMessage);
    this.renderMessages();
    this.setStatus("");
    this.updateControls();

    try {
      const updateAssistantMessage = (
        response: { text: string; details: ChatMessageDetail[]; blocks?: ChatMessageBlock[] },
      ): void => {
        if (!this.isCurrentRequest(activeRequest)) {
          return;
        }

        assistantMessage.text = response.text;
        assistantMessage.details = response.details;
        assistantMessage.blocks = response.blocks;
        this.renderMessages();
      };
      const response = await this.plugin.sendChatMessage(
        text,
        updateAssistantMessage,
        (request) => this.presentQuestion(request, activeRequest),
      );
      if (!this.isCurrentRequest(activeRequest)) {
        return;
      }

      assistantMessage.text = response.text;
      assistantMessage.details = response.details;
      assistantMessage.blocks = response.blocks;
      void this.populateSessionSelect();
      this.setStatus("");
    } catch (error) {
      if (!this.isCurrentRequest(activeRequest)) {
        return;
      }

      const message = formatError(error);
      assistantMessage.role = "error";
      assistantMessage.text = message;
      assistantMessage.details = [];
      this.clearActiveQuestion();
      this.setStatus("リクエストに失敗しました。");
      new Notice(`OpenCode のリクエストに失敗しました: ${message}`);
    } finally {
      if (this.activeRequest?.id === activeRequest.id) {
        this.pending = false;
        this.activeRequest = null;
        this.clearActiveQuestion();
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
        text: "まだメッセージはありません。",
      });
      return;
    }

    const lastAssistantMessage = [...this.messages].reverse().find((message) => message.role === "assistant");

    for (const message of this.messages) {
      const isActiveAssistantMessage = this.pending && message === this.messages[this.messages.length - 1];
      const hasDetails = message.role === "assistant" && message.details && message.details.length > 0;
      const hasBlocks = message.role === "assistant" && message.blocks && message.blocks.length > 0;
      const hasTextBlock = Boolean(message.blocks?.some((block) => block.type === "text" && block.text));
      const endsWithDetail =
        message.role === "assistant" &&
        (hasBlocks
          ? message.blocks?.[message.blocks.length - 1]?.type === "detail"
          : hasDetails && !message.text);
      const isDetailsOnlyAssistant = (hasDetails || hasBlocks) && !message.text && !hasTextBlock;
      const messageEl = this.historyEl.createDiv({
        cls: [
          "opencode-chat-message",
          `opencode-chat-message-${message.role}`,
          isDetailsOnlyAssistant ? "opencode-chat-message-details-only" : "",
          endsWithDetail ? "opencode-chat-message-ends-detail" : "",
          message.role === "assistant" && message.text ? "opencode-chat-message-final" : "",
        ].filter(Boolean).join(" "),
      });
      if (hasBlocks) {
        renderMessageBlocks(
          messageEl,
          message.blocks ?? [],
          !message.text && (isActiveAssistantMessage || message === lastAssistantMessage),
          this,
        );
      } else if (hasDetails) {
        renderMessageDetails(
          messageEl,
          message.details ?? [],
          !message.text && (isActiveAssistantMessage || message === lastAssistantMessage),
        );
      }

      if (!hasBlocks && message.text) {
        renderMessageText(messageEl, message, this);
      } else if (isActiveAssistantMessage && message.role === "assistant" && !hasBlocks && (!message.details || message.details.length === 0)) {
        messageEl.createDiv({
          cls: "opencode-chat-message-waiting",
          text: "応答を待機中...",
        });
      }
    }

    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  private updateControls(): void {
    const answeringQuestion = this.activeQuestion !== null;
    const usesComposerInput = this.activeQuestionUsesComposerInput();
    this.composerEl.toggleClass("is-answering-question", answeringQuestion);
    this.inputEl.disabled = this.pending && !usesComposerInput;
    this.inputEl.toggleClass("is-hidden", answeringQuestion && !usesComposerInput);
    this.questionEl.toggleClass("is-hidden", !answeringQuestion);
    this.selectorGroupEl.toggleClass("is-hidden", answeringQuestion);
    this.sendButtonEl.disabled = answeringQuestion && !this.canSubmitQuestionAnswer();
    this.sessionPickerButtonEl.disabled = this.pending;
    this.modelPickerButtonEl.disabled = this.pending;
    this.effortPickerButtonEl.disabled = this.pending;
    this.sendButtonEl.setAttribute(
      "aria-label",
      answeringQuestion ? "質問に回答" : this.pending ? "応答を停止" : "メッセージを送信",
    );
    this.sendButtonEl.empty();
    setIcon(this.sendButtonEl, this.pending && !answeringQuestion ? "square" : "send-horizontal");
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
    this.resolveActiveQuestion({ type: "reject" });
    this.plugin.resetSession();
    this.setStatus("リクエストを中断しました。");
    this.renderMessages();
    this.updateControls();
    this.inputEl.focus();
  }

  private isCurrentRequest(request: ActiveChatRequest): boolean {
    return this.activeRequest?.id === request.id && !request.interrupted;
  }

  private presentQuestion(
    request: OpenCodeQuestionRequest,
    activeRequest: ActiveChatRequest,
  ): Promise<OpenCodeQuestionResolution> {
    if (!this.isCurrentRequest(activeRequest)) {
      return Promise.resolve({ type: "reject" });
    }

    this.resolveActiveQuestion({ type: "reject" });

    return new Promise((resolve) => {
      this.activeQuestion = {
        request,
        currentIndex: 0,
        selections: request.questions.map(() => []),
        customValues: request.questions.map(() => ""),
        submitting: false,
        resolve,
      };
      this.syncQuestionInput();
      this.renderQuestionComposer();
      this.setStatus("OpenCode からの質問に回答してください。");
      this.updateControls();
      this.focusQuestionComposer();
    });
  }

  private renderQuestionComposer(): void {
    this.questionEl.empty();
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    const headerEl = this.questionEl.createDiv({ cls: "opencode-chat-question-header" });
    const iconEl = headerEl.createSpan({ cls: "opencode-chat-question-icon" });
    setIcon(iconEl, "circle-help");
    headerEl.createSpan({ cls: "opencode-chat-question-title", text: "質問への回答" });
    if (activeQuestion.request.questions.length > 1) {
      headerEl.createSpan({
        cls: "opencode-chat-question-page-indicator",
        text: `${activeQuestion.currentIndex + 1} / ${activeQuestion.request.questions.length}`,
      });
    }

    const question = activeQuestion.request.questions[activeQuestion.currentIndex];
    if (!question) {
      return;
    }

    const itemEl = this.questionEl.createDiv({ cls: "opencode-chat-question-item" });
    itemEl.createDiv({
      cls: "opencode-chat-question-item-header",
      text: question.header || `質問 ${activeQuestion.currentIndex + 1}`,
    });
    itemEl.createDiv({
      cls: "opencode-chat-question-text",
      text: question.question,
    });

    if (question.options.length > 0) {
      const optionsEl = itemEl.createDiv({
        cls: `opencode-chat-question-options${question.multiple ? " is-multiple" : ""}`,
      });
      for (const option of question.options) {
        const selected = activeQuestion.selections[activeQuestion.currentIndex]?.includes(option.label) ?? false;
        const optionButtonEl = optionsEl.createEl("button", {
          cls: `opencode-chat-question-option${selected ? " is-selected" : ""}`,
          attr: {
            type: "button",
            "aria-pressed": String(selected),
          },
        });
        const optionIconEl = optionButtonEl.createSpan({ cls: "opencode-chat-question-option-icon" });
        setIcon(optionIconEl, selected ? "check" : question.multiple ? "square" : "circle");
        const optionTextEl = optionButtonEl.createSpan({ cls: "opencode-chat-question-option-text" });
        optionTextEl.createSpan({ cls: "opencode-chat-question-option-label", text: option.label });
        if (option.description) {
          optionTextEl.createSpan({ cls: "opencode-chat-question-option-description", text: option.description });
        }
        optionButtonEl.addEventListener("click", () => {
          this.toggleQuestionOption(activeQuestion.currentIndex, option.label);
        });
      }
    }

    if (activeQuestion.request.questions.length > 1) {
      this.renderQuestionPager();
    }
  }

  private focusQuestionComposer(): void {
    if (this.activeQuestionUsesComposerInput()) {
      this.inputEl.focus();
      return;
    }

    const focusTarget = this.questionEl.querySelector("button, textarea");
    if (focusTarget instanceof HTMLElement) {
      focusTarget.focus();
    }
  }

  private renderQuestionPager(): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    const pagerEl = this.questionEl.createDiv({ cls: "opencode-chat-question-pager" });
    const previousButtonEl = pagerEl.createEl("button", {
      cls: "opencode-chat-question-page-button",
      attr: {
        type: "button",
        "aria-label": "前の質問",
      },
    });
    setIcon(previousButtonEl, "chevron-left");
    previousButtonEl.disabled = activeQuestion.currentIndex === 0;
    previousButtonEl.addEventListener("click", () => {
      this.setQuestionPage(activeQuestion.currentIndex - 1);
    });

    pagerEl.createSpan({
      cls: "opencode-chat-question-page-count",
      text: `${activeQuestion.currentIndex + 1} / ${activeQuestion.request.questions.length}`,
    });

    const nextButtonEl = pagerEl.createEl("button", {
      cls: "opencode-chat-question-page-button",
      attr: {
        type: "button",
        "aria-label": "次の質問",
      },
    });
    setIcon(nextButtonEl, "chevron-right");
    nextButtonEl.disabled =
      activeQuestion.currentIndex >= activeQuestion.request.questions.length - 1 ||
      this.currentQuestionAnswer().length === 0;
    nextButtonEl.addEventListener("click", () => {
      this.setQuestionPage(activeQuestion.currentIndex + 1);
    });
  }

  private setQuestionPage(index: number): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, activeQuestion.request.questions.length - 1));
    if (nextIndex === activeQuestion.currentIndex) {
      return;
    }

    this.saveCurrentQuestionInput();
    activeQuestion.currentIndex = nextIndex;
    this.syncQuestionInput();
    this.renderQuestionComposer();
    this.updateControls();
    this.focusQuestionComposer();
  }

  private toggleQuestionOption(questionIndex: number, label: string): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    const question = activeQuestion.request.questions[questionIndex];
    const current = activeQuestion.selections[questionIndex] ?? [];
    if (question.multiple) {
      activeQuestion.selections[questionIndex] = current.includes(label)
        ? current.filter((value) => value !== label)
        : [...current, label];
    } else {
      activeQuestion.selections[questionIndex] = current.includes(label) ? [] : [label];
    }

    this.renderQuestionComposer();
    this.updateControls();
    this.focusQuestionComposer();
  }

  private submitQuestionAnswer(): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion || !this.canSubmitQuestionAnswer()) {
      return;
    }

    activeQuestion.submitting = true;
    this.saveCurrentQuestionInput();
    this.updateControls();
    const answers = activeQuestion.request.questions.map((_, index) => this.questionAnswerAt(index));
    this.resolveActiveQuestion({ type: "reply", answers });
    this.setStatus("");
  }

  private canSubmitQuestionAnswer(): boolean {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion || activeQuestion.submitting) {
      return false;
    }

    return activeQuestion.request.questions.every((_, index) => this.questionAnswerAt(index).length > 0);
  }

  private questionAnswerAt(index: number): OpenCodeQuestionAnswer {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return [];
    }

    const question = activeQuestion.request.questions[index];
    const custom = this.questionCustomAnswerAt(index);
    const selections = activeQuestion.selections[index] ?? [];
    if (custom && !question.multiple && selections.length === 0) {
      return [custom];
    }

    return [
      ...selections,
      ...(custom ? [custom] : []),
    ];
  }

  private currentQuestionAnswer(): OpenCodeQuestionAnswer {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return [];
    }

    return this.questionAnswerAt(activeQuestion.currentIndex);
  }

  private updateActiveQuestionInput(): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      this.updateControls();
      return;
    }

    activeQuestion.customValues[activeQuestion.currentIndex] = this.inputEl.value;
    this.renderQuestionComposer();
    this.updateControls();
  }

  private questionCustomAnswerAt(index: number): string {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return "";
    }

    if (activeQuestion.currentIndex === index) {
      return this.inputEl.value.trim();
    }

    return (activeQuestion.customValues[index] ?? "").trim();
  }

  private saveCurrentQuestionInput(): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    activeQuestion.customValues[activeQuestion.currentIndex] = this.inputEl.value;
  }

  private syncQuestionInput(): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    this.inputEl.value = activeQuestion.customValues[activeQuestion.currentIndex] ?? "";
    this.inputEl.setAttribute("placeholder", this.questionInputPlaceholder());
    this.resizeInput();
  }

  private activeQuestionUsesComposerInput(): boolean {
    return this.activeQuestion !== null;
  }

  private questionInputPlaceholder(): string {
    const question = this.activeQuestion?.request.questions[this.activeQuestion.currentIndex];
    if (!question) {
      return DEFAULT_INPUT_PLACEHOLDER;
    }

    return question.options.length > 0 ? "その他・追記事項があれば入力..." : "回答を入力...";
  }

  private resolveActiveQuestion(resolution: OpenCodeQuestionResolution): void {
    const activeQuestion = this.activeQuestion;
    if (!activeQuestion) {
      return;
    }

    this.activeQuestion = null;
    this.questionEl.empty();
    this.resetQuestionInput();
    activeQuestion.resolve(resolution);
    this.updateControls();
  }

  private clearActiveQuestion(): void {
    this.activeQuestion = null;
    this.questionEl.empty();
    this.resetQuestionInput();
  }

  private resetQuestionInput(): void {
    this.composerEl.removeClass("is-answering-question");
    this.inputEl.value = "";
    this.inputEl.setAttribute("placeholder", DEFAULT_INPUT_PLACEHOLDER);
    this.resizeInput();
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private resizeInput(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, maxInputHeight(this.inputEl))}px`;
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
      this.setStatus(`モデルを読み込めません: ${formatError(error)}`);
    }

    this.normalizeSelectedEffort();
    this.updatePickerLabels();
  }

  private async populateSessionSelect(): Promise<void> {
    this.sessionList = [];
    this.sessionOptions = [];

    try {
      const sessions = await this.plugin.listSessions();
      this.sessionList = sessions;
      this.sessionOptions = sessions.map((session) => ({
        value: session.id,
        label: session.title,
      }));
      if (this.screen === "sessions") {
        this.renderSessionHistory();
      }
    } catch (error) {
      this.setStatus(`セッションを読み込めません: ${formatError(error)}`);
    }

    this.updatePickerLabels();
  }

  private updatePickerLabels(): void {
    const selectedSession = this.sessionOptions.find((option) => option.value === this.plugin.currentSessionId());
    setPickerButtonContent(this.sessionPickerButtonEl, selectedSession?.label ?? "新規チャット");

    const selectedModel = selectedModelValue(this.plugin.settings.providerID, this.plugin.settings.modelID);
    const selectedModelOption = this.modelOptions.find((option) => option.value === selectedModel);
    setPickerButtonContent(this.modelPickerButtonEl, selectedModelOption?.label ?? "モデルを選択");

    const effortOptions = this.currentEffortOptions();
    this.effortPickerButtonEl.toggleClass("is-hidden", effortOptions.length === 0);
    if (effortOptions.length === 0) {
      this.plugin.settings.reasoningEffort = "";
      return;
    }

    this.normalizeSelectedEffort();
    setPickerButtonContent(this.effortPickerButtonEl, effortLabel(this.plugin.settings.reasoningEffort));
  }

  private async showSessionHistory(): Promise<void> {
    if (this.screen === "sessions") {
      this.showChat();
      return;
    }

    this.screen = "sessions";
    this.closePickerMenu();
    this.statusEl.addClass("is-hidden");
    this.historyEl.addClass("is-hidden");
    this.composerEl.addClass("is-hidden");
    this.sessionPickerWrapEl.addClass("is-hidden");
    this.sessionHistoryTitleEl.removeClass("is-hidden");
    this.sessionHistoryEl.removeClass("is-hidden");
    this.sessionHistoryButtonEl.setAttribute("aria-label", "チャットに戻る");
    this.sessionHistoryButtonEl.empty();
    setIcon(this.sessionHistoryButtonEl, "message-circle");
    await this.populateSessionSelect();
    this.renderSessionHistory();
  }

  private showChat(): void {
    this.screen = "chat";
    this.sessionHistoryEl.addClass("is-hidden");
    this.statusEl.removeClass("is-hidden");
    this.historyEl.removeClass("is-hidden");
    this.composerEl.removeClass("is-hidden");
    this.sessionHistoryTitleEl.addClass("is-hidden");
    this.sessionPickerWrapEl.removeClass("is-hidden");
    this.sessionHistoryButtonEl.setAttribute("aria-label", "セッション履歴を開く");
    this.sessionHistoryButtonEl.empty();
    setIcon(this.sessionHistoryButtonEl, "history");
  }

  private renderSessionHistory(): void {
    renderSessionHistory(this.sessionHistoryEl, this.sessionList, {
      currentSessionId: () => this.plugin.currentSessionId(),
      onCancelRename: () => this.renderSessionHistory(),
      onDelete: (session) => {
        void this.deleteSession(session);
      },
      onRename: (sessionId, title) => this.renameSession(sessionId, title),
      onSelect: (sessionId) => {
        void this.selectSessionFromHistory(sessionId);
      },
    });
  }

  private async renameSession(sessionId: string, title: string): Promise<void> {
    try {
      const updatedSession = await this.plugin.renameSession(sessionId, title);
      this.sessionList = this.sessionList.map((session) =>
        session.id === sessionId ? { ...session, title: updatedSession.title } : session,
      );
      this.sessionOptions = this.sessionOptions.map((option) =>
        option.value === sessionId ? { ...option, label: updatedSession.title } : option,
      );
      this.renderSessionHistory();
      this.updatePickerLabels();
    } catch (error) {
      new Notice(`セッション名を変更できません: ${formatError(error)}`);
      this.renderSessionHistory();
    }
  }

  private async deleteSession(session: OpenCodeSessionOption): Promise<void> {
    if (!window.confirm(`セッション「${session.title}」を削除しますか？`)) {
      return;
    }

    try {
      await this.plugin.deleteSession(session.id);
      this.sessionList = this.sessionList.filter((item) => item.id !== session.id);
      this.sessionOptions = this.sessionOptions.filter((option) => option.value !== session.id);
      this.renderSessionHistory();
      this.updatePickerLabels();
      if (this.plugin.currentSessionId() === "") {
        this.messages = [];
        this.renderMessages();
      }
    } catch (error) {
      new Notice(`セッションを削除できません: ${formatError(error)}`);
    }
  }

  private async selectSessionFromHistory(sessionId: string): Promise<void> {
    if (!sessionId) {
      this.plugin.startNewSession();
      this.showChat();
      this.updatePickerLabels();
      return;
    }

    await this.plugin.selectSession(sessionId);
    this.showChat();
    this.updateSelectedSessionHistoryItem();
    this.updatePickerLabels();
  }

  private updateSelectedSessionHistoryItem(): void {
    updateSelectedSessionHistoryItem(this.sessionHistoryEl, this.plugin.currentSessionId());
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
    renderPickerMenuContents(menuEl, config, {
      currentFavoriteValuesFor: (menuConfig) => this.currentFavoriteValuesFor(menuConfig),
      closePickerMenu: () => this.closePickerMenu(),
    });
  }

  private currentFavoriteValuesFor(config: PickerMenuConfig): string[] {
    if (config.kind === "model") {
      return this.plugin.settings.visibleModelIDs;
    }

    if (config.kind === "session") {
      return [];
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

