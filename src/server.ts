import { ChildProcess, spawn } from "node:child_process";
import { parseServerAddress } from "./address";
import { OpenCodeClient } from "./opencode";
import { OpenCodeChatSettings } from "./types";

export class OpenCodeServerManager {
  private process: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(private readonly getSettings: () => OpenCodeChatSettings) {}

  async ensureStarted(): Promise<void> {
    if (await this.isHealthy()) {
      return;
    }

    if (!this.startPromise) {
      this.startPromise = this.start();
    }

    await this.startPromise;
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.startPromise = null;
  }

  reset(): void {
    this.stop();
  }

  private async start(): Promise<void> {
    const settings = this.getSettings();
    const address = parseServerAddress(settings.serverAddress);
    const command = settings.opencodeCommand.trim() || "opencode";
    const env = { ...process.env };

    this.process = spawn(
      command,
      ["serve", "--hostname", address.host, "--port", String(address.port)],
      {
        env,
        shell: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );

    this.process.once("exit", () => {
      this.process = null;
      this.startPromise = null;
    });

    await this.waitUntilHealthy();
  }

  private async waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + 15_000;
    let lastError = "";

    while (Date.now() < deadline) {
      try {
        const health = await new OpenCodeClient(this.getSettings()).health();
        if (health.healthy) {
          return;
        }
      } catch (error) {
        lastError = formatError(error);
      }

      await sleep(500);
    }

    throw new Error(lastError || "Timed out waiting for opencode server.");
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const health = await new OpenCodeClient(this.getSettings()).health();
      return health.healthy;
    } catch {
      return false;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
