import { requestUrl, RequestUrlParam } from "obsidian";
import { parseServerAddress } from "./address";
import { JsonRecord, readStringProperty } from "./json";
import {
  AssistantUpdateHandler,
  OpenCodeAssistantResponse,
  assistantMessagesAfter,
  extractAssistantResponse,
  isCompletedAssistantMessageRecord,
  isFinalAssistantMessage,
} from "./messages";
import { extractModelOptions } from "./models";
import { OpenCodeChatSettings, OpenCodeModelOption } from "../shared/types";

export { OpenCodeAssistantResponse } from "./messages";

const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

export class OpenCodeClient {
  constructor(private readonly settings: OpenCodeChatSettings) {}

  async health(): Promise<{ healthy: boolean; version?: string }> {
    return await this.requestJson<{ healthy: boolean; version?: string }>("/global/health");
  }

  async listModels(): Promise<OpenCodeModelOption[]> {
    const response = await this.requestJson<unknown>("/provider");
    return extractModelOptions(response);
  }

  async createSession(): Promise<string> {
    const response = await this.requestJson<unknown>("/session", {
      method: "POST",
      body: JSON.stringify({ title: "Obsidian Chat" }),
    });

    const id = readStringProperty(response, "id");
    if (!id) {
      throw new Error("opencode did not return a session id.");
    }

    return id;
  }

  async sendMessage(
    sessionId: string,
    text: string,
    onUpdate?: AssistantUpdateHandler,
  ): Promise<OpenCodeAssistantResponse> {
    const previousMessages = await this.listSessionMessages(sessionId);

    await this.requestJson<unknown>(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(this.messageBody(text)),
    });

    const response = await this.waitForAssistantResponse(sessionId, previousMessages.length, onUpdate);
    return extractAssistantResponse(response, { includeFallbackText: true });
  }

  private async listSessionMessages(sessionId: string): Promise<unknown[]> {
    return await this.requestJson<unknown[]>(`/session/${encodeURIComponent(sessionId)}/message`);
  }

  private async waitForAssistantResponse(
    sessionId: string,
    previousMessageCount: number,
    onUpdate?: AssistantUpdateHandler,
  ): Promise<unknown[]> {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    let previousSnapshot = "";

    while (Date.now() < deadline) {
      const messages = await this.listSessionMessages(sessionId);
      const assistantMessages = assistantMessagesAfter(messages, previousMessageCount);
      if (assistantMessages.length > 0) {
        const snapshot = JSON.stringify(assistantMessages);
        if (snapshot !== previousSnapshot) {
          previousSnapshot = snapshot;
          onUpdate?.(extractAssistantResponse(assistantMessages));
        }
      }

      const completedMessages = assistantMessages.filter(isCompletedAssistantMessageRecord);
      if (completedMessages.some(isFinalAssistantMessage)) {
        return completedMessages;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for opencode response after ${Math.round(RESPONSE_TIMEOUT_MS / 1000)} seconds.`);
  }

  private async requestJson<T>(path: string, init: Partial<RequestUrlParam> = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    };

    const response = await requestUrl({
      url: `${this.baseUrl()}${path}`,
      method: init.method ?? "GET",
      body: init.body,
      headers,
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      const message = response.text || `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (!response.text) {
      return undefined as T;
    }

    return response.json as T;
  }

  private baseUrl(): string {
    const { host, port } = parseServerAddress(this.settings.serverAddress);
    return `http://${host}:${port}`;
  }

  private messageBody(text: string): JsonRecord {
    const body: JsonRecord = {
      parts: [{ type: "text", text }],
    };

    if (this.settings.providerID && this.settings.modelID) {
      body.model = {
        providerID: this.settings.providerID,
        modelID: this.settings.modelID,
      };
    }

    return body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
