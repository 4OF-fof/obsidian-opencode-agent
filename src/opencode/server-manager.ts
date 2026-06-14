import { ChildProcess, spawn } from "node:child_process";
import { OpenCodeClient } from "./client";
import { OpenCodeChatSettings } from "../shared/types";

const MANAGED_SERVER_HOST = "127.0.0.1";
const MANAGED_SERVER_PORT = 4097;
const MANAGED_SERVER_ADDRESS = `${MANAGED_SERVER_HOST}:${MANAGED_SERVER_PORT}`;

export class OpenCodeServerManager {
  private process: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private activeServerAddress: string | null = null;

  constructor(
    private readonly getSettings: () => OpenCodeChatSettings,
    private readonly getWorkingDirectory: () => string | undefined,
  ) {}

  async ensureStarted(): Promise<void> {
    if (this.process && this.activeServerAddress && await this.isHealthy(this.activeServerAddress)) {
      return;
    }

    if (!this.startPromise) {
      this.startPromise = this.start();
    }

    await this.startPromise;
  }

  clientSettings(): OpenCodeChatSettings {
    return {
      ...this.getSettings(),
      serverAddress: this.activeServerAddress ?? MANAGED_SERVER_ADDRESS,
    };
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.startPromise = null;
    this.activeServerAddress = null;
  }

  reset(): void {
    this.stop();
  }

  private async start(): Promise<void> {
    const settings = this.getSettings();
    const command = settings.opencodeCommand.trim() || "opencode";
    const env = { ...process.env };
    const cwd = this.getWorkingDirectory();
    this.activeServerAddress = MANAGED_SERVER_ADDRESS;
    this.process = spawn(
      command,
      ["serve", "--hostname", MANAGED_SERVER_HOST, "--port", String(MANAGED_SERVER_PORT)],
      {
        cwd,
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

    try {
      await this.waitUntilHealthy(this.activeServerAddress);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  private async waitUntilHealthy(serverAddress: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    let lastError = "";

    while (Date.now() < deadline) {
      try {
        const health = await new OpenCodeClient({ ...this.getSettings(), serverAddress }).health();
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

  private async isHealthy(serverAddress: string): Promise<boolean> {
    try {
      const health = await new OpenCodeClient({ ...this.getSettings(), serverAddress }).health();
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
