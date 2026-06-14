import { FileSystemAdapter, Notice, Plugin } from "obsidian";
import { OpenCodeAssistantResponse, OpenCodeClient } from "../opencode/client";
import { OpenCodeServerManager } from "../opencode/server-manager";
import { OpenCodeChatSettingTab } from "../ui/settings";
import { DEFAULT_SETTINGS, OpenCodeChatSettings, OpenCodeModelOption } from "../shared/types";
import { OpenCodeChatView, VIEW_TYPE_OPENCODE_CHAT } from "../ui/view";

export default class OpenCodeChatPlugin extends Plugin {
  settings: OpenCodeChatSettings = { ...DEFAULT_SETTINGS };
  readonly server = new OpenCodeServerManager(() => this.settings, () => this.vaultBasePath());
  private sessionId: string | null = null;
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

  private vaultBasePath(): string | undefined {
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
      this.sessionId = await client.createSession();
    }

    return await client.sendMessage(this.sessionId, text, onUpdate);
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
}
