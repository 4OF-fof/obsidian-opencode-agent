import { Notice, Plugin } from "obsidian";
import { normalizeServerAddress } from "./address";
import { OpenCodeClient } from "./opencode";
import { OpenCodeServerManager } from "./server";
import { OpenCodeChatSettingTab } from "./settings";
import { DEFAULT_SETTINGS, OpenCodeChatSettings, OpenCodeModelOption } from "./types";
import { OpenCodeChatView, VIEW_TYPE_OPENCODE_CHAT } from "./view";

export default class OpenCodeChatPlugin extends Plugin {
  settings: OpenCodeChatSettings = { ...DEFAULT_SETTINGS };
  readonly server = new OpenCodeServerManager(() => this.settings);
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
    void this.refreshModels();
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
      serverAddress: migrateServerAddress(data),
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

  async testConnection(): Promise<{ healthy: boolean; version?: string }> {
    await this.server.ensureStarted();
    return await new OpenCodeClient(this.settings).health();
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
    return await new OpenCodeClient(this.settings).listModels();
  }

  async sendChatMessage(text: string): Promise<string> {
    await this.server.ensureStarted();
    const client = new OpenCodeClient(this.settings);

    if (!this.sessionId) {
      this.sessionId = await client.createSession();
    }

    return await client.sendMessage(this.sessionId, text);
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

function migrateServerAddress(data: unknown): string {
  if (isRecord(data) && typeof data.serverAddress === "string" && data.serverAddress.trim()) {
    return normalizeServerAddress(data.serverAddress);
  }

  if (isRecord(data)) {
    const host = typeof data.host === "string" && data.host.trim() ? data.host : "localhost";
    const port = typeof data.port === "number" && Number.isFinite(data.port) ? data.port : 4096;
    return normalizeServerAddress(`${host}:${port}`);
  }

  return DEFAULT_SETTINGS.serverAddress;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
