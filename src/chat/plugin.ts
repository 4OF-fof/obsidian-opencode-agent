import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { OpenCodeAssistantResponse, OpenCodeClient } from "./opencode/client";
import { OpenCodeServerManager } from "./opencode/server-manager";
import { OpenCodeChatSettingTab } from "./ui/settings";
import { ChatMessage, DEFAULT_SETTINGS, OpenCodeChatSettings, OpenCodeModelOption, OpenCodeSessionOption } from "./shared/types";
import { OpenCodeChatView, VIEW_TYPE_OPENCODE_CHAT } from "./ui/view";

export type SessionSelectionListener = (messages: ChatMessage[]) => void;

export default class OpenCodeChatPlugin extends Plugin {
  settings: OpenCodeChatSettings = { ...DEFAULT_SETTINGS };
  readonly server = new OpenCodeServerManager(() => this.settings, () => this.vaultBasePath());
  private sessionId: string | null = null;
  private sessionMessages: ChatMessage[] = [];
  private sessionListeners = new Set<SessionSelectionListener>();
  private modelOptions: OpenCodeModelOption[] = [];
  private modelOptionsPromise: Promise<OpenCodeModelOption[]> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_OPENCODE_CHAT,
      (leaf) => new OpenCodeChatView(leaf, this),
    );

    this.addRibbonIcon("message-circle", "OpenCode Chat", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-opencode-chat",
      name: "Open OpenCode chat",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new OpenCodeChatSettingTab(this.app, this));
  }

  onunload(): void {
    this.server.stop();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_OPENCODE_CHAT);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  resetSession(): void {
    this.sessionId = null;
    this.sessionMessages = [];
  }

  currentSessionId(): string {
    return this.sessionId ?? "";
  }

  startNewSession(): void {
    this.resetSession();
    this.notifySessionListeners();
  }

  currentSessionMessages(): ChatMessage[] {
    return this.sessionMessages;
  }

  onSessionSelectionChange(listener: SessionSelectionListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  resetServer(): void {
    this.resetSession();
    this.modelOptions = [];
    this.modelOptionsPromise = null;
    this.server.reset();
  }

  async listModels(): Promise<OpenCodeModelOption[]> {
    if (this.modelOptions.length > 0) {
      return this.modelOptions;
    }

    if (this.modelOptionsPromise) {
      return await this.modelOptionsPromise;
    }

    return await this.refreshModels();
  }

  async refreshModels(): Promise<OpenCodeModelOption[]> {
    if (this.modelOptionsPromise) {
      return await this.modelOptionsPromise;
    }

    this.modelOptionsPromise = this.loadModels();
    try {
      this.modelOptions = await this.modelOptionsPromise;
      return this.modelOptions;
    } finally {
      this.modelOptionsPromise = null;
    }
  }

  private async loadModels(): Promise<OpenCodeModelOption[]> {
    await this.server.ensureStarted();
    return await new OpenCodeClient(this.server.clientSettings()).listModels();
  }

  async listSessions(): Promise<OpenCodeSessionOption[]> {
    await this.server.ensureStarted();
    return await new OpenCodeClient(this.server.clientSettings()).listSessions(this.vaultBasePath());
  }

  async selectSession(sessionId: string): Promise<ChatMessage[]> {
    await this.server.ensureStarted();
    this.sessionId = sessionId;
    this.sessionMessages = await new OpenCodeClient(this.server.clientSettings()).listSessionChatMessages(sessionId);
    this.notifySessionListeners();
    return this.sessionMessages;
  }

  async renameSession(sessionId: string, title: string): Promise<OpenCodeSessionOption> {
    await this.server.ensureStarted();
    return await new OpenCodeClient(this.server.clientSettings()).updateSessionTitle(sessionId, title);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.server.ensureStarted();
    await new OpenCodeClient(this.server.clientSettings()).deleteSession(sessionId);
    if (this.sessionId === sessionId) {
      this.resetSession();
      this.notifySessionListeners();
    }
  }

  protected vaultBasePath(): string | undefined {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
  }

  async sendChatMessage(
    text: string,
    onUpdate?: (response: OpenCodeAssistantResponse) => void,
  ): Promise<OpenCodeAssistantResponse> {
    await this.server.ensureStarted();
    const client = new OpenCodeClient(this.server.clientSettings());

    if (!this.sessionId) {
      this.sessionId = await client.createSession(titleFromPrompt(text));
    }

    const response = await client.sendMessage(this.sessionId, text, onUpdate);
    this.sessionMessages = await client.listSessionChatMessages(this.sessionId);
    this.notifySessionListeners();
    return response;
  }

  private async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_CHAT);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("Unable to open OpenCode Chat.");
        return;
      }

      await leaf.setViewState({
        type: VIEW_TYPE_OPENCODE_CHAT,
        active: true,
      });
    }

    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPENCODE_CHAT)[0];
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("Unable to open OpenCode Chat.");
    }
  }

  private notifySessionListeners(): void {
    const messages = this.sessionMessages;
    for (const listener of this.sessionListeners) {
      listener(messages);
    }
  }
}

function titleFromPrompt(text: string): string {
  const normalized = text
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}
