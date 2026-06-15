import { ChildProcess, spawn } from "node:child_process";
import { OpenCodeClient } from "./client";
import { detectOpenCodeCommand } from "./command";
import { parseServerAddress } from "./address";
import { OpenCodeChatSettings } from "../shared/types";

const DEFAULT_SERVER_ADDRESS = "127.0.0.1:4097";

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

    const configuredServerAddress = this.getSettings().serverAddress.trim() || DEFAULT_SERVER_ADDRESS;
    if (await this.isHealthy(configuredServerAddress)) {
      this.activeServerAddress = configuredServerAddress;
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
      serverAddress: this.activeServerAddress ?? this.getSettings().serverAddress,
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
    const { host, port } = parseServerAddress(settings.serverAddress || DEFAULT_SERVER_ADDRESS);
    const serverAddress = `${host}:${port}`;
    let command = "opencode";

    try {
      command = await detectOpenCodeCommand();
    } catch (error) {
      throw new Error(commandResolutionFailureMessage(error));
    }

    const cwd = this.getWorkingDirectory();
    this.activeServerAddress = serverAddress;
    this.process = spawn(
      command,
      ["serve", "--hostname", host, "--port", String(port)],
      {
        cwd,
        shell: true,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );

    let stderr = "";
    let processError: Error | null = null;
    this.process.stderr?.on("data", (data: Buffer) => {
      stderr = `${stderr}${data.toString()}`.slice(-2000);
    });

    this.process.once("error", (error) => {
      processError = error;
      this.process = null;
      this.startPromise = null;
    });

    this.process.once("exit", () => {
      this.process = null;
      this.startPromise = null;
    });

    try {
      await this.waitUntilHealthy(this.activeServerAddress);
    } catch (error) {
      this.stop();
      throw new Error(connectionFailureMessage(command, serverAddress, processError ?? error, stderr));
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

function connectionFailureMessage(
  command: string,
  serverAddress: string,
  error: unknown,
  stderr: string,
): string {
  const detail = formatError(error);
  const output = stderr.trim();
  return [
    `Unable to connect to opencode at ${serverAddress}.`,
    `Tried to start: ${command} serve.`,
    output || detail,
    "Make sure opencode is installed and discoverable from your login shell.",
  ].filter(Boolean).join(" ");
}

function commandResolutionFailureMessage(error: unknown): string {
  return [
    "Unable to find opencode command.",
    formatError(error),
    "Make sure opencode is installed and discoverable from your login shell.",
  ].filter(Boolean).join(" ");
}
