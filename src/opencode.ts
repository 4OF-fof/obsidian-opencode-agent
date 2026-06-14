import { requestUrl, RequestUrlParam } from "obsidian";
import { parseServerAddress } from "./address";
import { OpenCodeChatSettings, OpenCodeModelOption, ReasoningEffort } from "./types";

type JsonRecord = Record<string, unknown>;

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

  async sendMessage(sessionId: string, text: string): Promise<string> {
    const body: JsonRecord = {
      parts: [{ type: "text", text }],
    };

    if (this.settings.providerID && this.settings.modelID) {
      body.model = {
        providerID: this.settings.providerID,
        modelID: this.settings.modelID,
      };
    }

    const response = await this.requestJson<unknown>(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return extractAssistantText(response) || "(No text response)";
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
}

function extractModelOptions(value: unknown): OpenCodeModelOption[] {
  const providers = readArrayProperty(value, "all");
  const connectedProperty = readProperty(value, "connected");
  const connected = new Set((Array.isArray(connectedProperty) ? connectedProperty : []).filter(isString));
  const shouldFilterConnected = Array.isArray(connectedProperty);
  const result: OpenCodeModelOption[] = [];

  for (const provider of providers) {
    const providerID = readStringProperty(provider, "id") || readStringProperty(provider, "providerID");
    if (!providerID) {
      continue;
    }

    if (shouldFilterConnected && !connected.has(providerID)) {
      continue;
    }

    for (const model of findModelRecords(provider)) {
      const modelID = readStringProperty(model, "id") || readStringProperty(model, "modelID");
      if (!modelID) {
        continue;
      }

      const name = readStringProperty(model, "name");
      result.push({
        providerID,
        modelID,
        label: name ? `${providerID} / ${name}` : `${providerID} / ${modelID}`,
        effortOptions: extractReasoningEfforts(model),
      });
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

function extractReasoningEfforts(model: JsonRecord): ReasoningEffort[] {
  const variants = readProperty(model, "variants");
  if (!isRecord(variants)) {
    return [];
  }

  const efforts = new Set<ReasoningEffort>();
  for (const [variantID, variant] of Object.entries(variants)) {
    const effort =
      readStringProperty(variant, "reasoningEffort") ||
      readStringProperty(readProperty(variant, "reasoning"), "effort") ||
      variantID;
    if (effort) {
      efforts.add(effort);
    }
  }

  return Array.from(efforts).sort(compareReasoningEffort);
}

function compareReasoningEffort(a: ReasoningEffort, b: ReasoningEffort): number {
  const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "thinking"];
  const aIndex = order.indexOf(a);
  const bIndex = order.indexOf(b);
  if (aIndex >= 0 && bIndex >= 0) {
    return aIndex - bIndex;
  }
  if (aIndex >= 0) {
    return -1;
  }
  if (bIndex >= 0) {
    return 1;
  }
  return a.localeCompare(b);
}

function findModelRecords(provider: unknown): JsonRecord[] {
  const direct = readArrayProperty(provider, "models").filter(isRecord);
  if (direct.length > 0) {
    return direct;
  }

  const directMap = readModelMap(provider, "models");
  if (directMap.length > 0) {
    return directMap;
  }

  const nested = readArrayProperty(readProperty(provider, "model"), "models").filter(isRecord);
  if (nested.length > 0) {
    return nested;
  }

  const nestedMap = readModelMap(readProperty(provider, "model"), "models");
  if (nestedMap.length > 0) {
    return nestedMap;
  }

  return [];
}

function extractAssistantText(value: unknown): string {
  const parts = readArrayProperty(value, "parts");
  const texts = parts.flatMap((part) => collectAssistantTextPart(part));
  return texts.join("\n").trim();
}

function collectAssistantTextPart(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  const type = readStringProperty(value, "type");
  if (type !== "text" && type !== "markdown" && type !== "message") {
    return [];
  }

  const directText =
    readStringProperty(value, "text") ||
    readStringProperty(value, "content") ||
    readStringProperty(value, "markdown");
  if (directText) {
    return [directText];
  }

  const nested = readProperty(value, "data");
  if (isRecord(nested)) {
    const nestedText =
      readStringProperty(nested, "text") ||
      readStringProperty(nested, "content") ||
      readStringProperty(nested, "markdown");
    return nestedText ? [nestedText] : [];
  }

  return [];
}

function readProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function readStringProperty(value: unknown, key: string): string {
  const property = readProperty(value, key);
  return typeof property === "string" ? property : "";
}

function readArrayProperty(value: unknown, key: string): unknown[] {
  const property = readProperty(value, key);
  return Array.isArray(property) ? property : [];
}

function readModelMap(value: unknown, key: string): JsonRecord[] {
  const property = readProperty(value, key);
  if (!isRecord(property)) {
    return [];
  }

  return Object.entries(property).map(([id, model]) => {
    if (isRecord(model)) {
      return { id, ...model };
    }

    return { id, name: String(model) };
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
