import { ChatMessage, ChatMessageDetail } from "../shared/types";
import {
  JsonRecord,
  isRecord,
  normalizePartType,
  readArrayProperty,
  readProperty,
  readStringProperty,
  stripAnsi,
} from "./json";
import { readToolDetailText, toolTitle } from "./tool-format";

export type AssistantUpdateHandler = (response: OpenCodeAssistantResponse) => void;

export interface OpenCodeAssistantResponse {
  text: string;
  details: ChatMessageDetail[];
}

export function extractAssistantResponse(value: unknown): OpenCodeAssistantResponse {
  const parts = readMessageParts(value);
  const texts: string[] = [];
  const details: ChatMessageDetail[] = [];

  for (const part of parts) {
    const textParts = collectAssistantTextPart(part);
    if (textParts.length > 0) {
      texts.push(...textParts);
      continue;
    }

    const detail = collectAssistantDetailPart(part);
    if (detail) {
      details.push(detail);
    }

  }

  return {
    text: texts.join("\n").trim(),
    details,
  };
}

export function assistantMessagesAfter(messages: unknown[], previousMessageCount: number): JsonRecord[] {
  return messages.slice(previousMessageCount).filter(isAssistantMessageRecord);
}

export function isCompletedAssistantMessageRecord(value: unknown): value is JsonRecord {
  if (!isAssistantMessageRecord(value)) {
    return false;
  }

  return typeof readProperty(readProperty(readProperty(value, "info"), "time"), "completed") === "number";
}

export function isFinalAssistantMessage(value: JsonRecord): boolean {
  const info = readProperty(value, "info");
  const finish = readStringProperty(info, "finish");
  return finish !== "tool-calls";
}

export function extractChatMessages(value: unknown): ChatMessage[] {
  const records = Array.isArray(value) ? value : [];
  const messages: ChatMessage[] = [];

  for (const record of records) {
    const role = readMessageRole(record);
    if (role === "assistant") {
      const response = extractAssistantResponse(record);
      if (response.text || response.details.length > 0) {
        messages.push({ role: "assistant", text: response.text, details: response.details });
      }
      continue;
    }

    if (role === "user") {
      const text = extractUserMessageText(record);
      if (text) {
        messages.push({ role: "user", text });
      }
    }
  }

  return messages;
}

function isAssistantMessageRecord(value: unknown): value is JsonRecord {
  return isRecord(value) && readStringProperty(readProperty(value, "info"), "role") === "assistant";
}

function readMessageRole(value: unknown): string {
  return readStringProperty(readProperty(value, "info"), "role") || readStringProperty(value, "role");
}

function extractUserMessageText(value: unknown): string {
  const parts = readMessageParts(value);
  const texts: string[] = [];

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }

    const type = readStringProperty(part, "type");
    if (type && type !== "text" && type !== "markdown" && type !== "message") {
      continue;
    }

    const directText =
      readStringProperty(part, "text") ||
      readStringProperty(part, "content") ||
      readStringProperty(part, "markdown");
    if (directText) {
      texts.push(stripAnsi(directText));
      continue;
    }

    const nested = readProperty(part, "data");
    const nestedText =
      readStringProperty(nested, "text") ||
      readStringProperty(nested, "content") ||
      readStringProperty(nested, "markdown");
    if (nestedText) {
      texts.push(stripAnsi(nestedText));
    }
  }

  return texts.join("\n").trim();
}

function readMessageParts(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap(readMessageParts);
  }

  const direct = readArrayProperty(value, "parts");
  if (direct.length > 0) {
    return direct;
  }

  const message = readArrayProperty(readProperty(value, "message"), "parts");
  if (message.length > 0) {
    return message;
  }

  return readArrayProperty(readProperty(value, "data"), "parts");
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
    return [stripAnsi(directText)];
  }

  const nested = readProperty(value, "data");
  if (isRecord(nested)) {
    const nestedText =
      readStringProperty(nested, "text") ||
      readStringProperty(nested, "content") ||
      readStringProperty(nested, "markdown");
    return nestedText ? [stripAnsi(nestedText)] : [];
  }

  return [];
}

function collectAssistantDetailPart(value: unknown): ChatMessageDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = readStringProperty(value, "type") || "part";
  if (shouldIgnoreDetailType(type)) {
    return null;
  }

  const text = readDetailText(value);
  const kind = detailKindForType(type);
  if (!text && kind !== "tool") {
    return null;
  }

  return {
    kind,
    title: detailTitle(value, type),
    text,
  };
}

function detailKindForType(type: string): ChatMessageDetail["kind"] {
  const normalized = normalizePartType(type);
  if (normalized.includes("reason") || normalized.includes("thinking") || normalized.includes("thought")) {
    return "reasoning";
  }

  if (normalized.includes("tool") || normalized.includes("function") || normalized.includes("command")) {
    return "tool";
  }

  return "other";
}

function detailTitle(value: JsonRecord, type: string): string {
  if (detailKindForType(type) === "tool") {
    const state = readProperty(value, "state");
    const input = readProperty(value, "input") ?? readProperty(state, "input");
    return toolTitle(readStringProperty(value, "tool"), input);
  }

  const name =
    readStringProperty(value, "title") ||
    readStringProperty(value, "name") ||
    readStringProperty(value, "tool") ||
    readStringProperty(value, "toolName");
  const kind = detailKindForType(type);
  const label = kind === "reasoning" ? "Thinking" : kind === "tool" ? "Tool call" : "Detail";
  return name ? `${label}: ${name}` : `${label}: ${type}`;
}

function readDetailText(value: JsonRecord): string {
  const type = readStringProperty(value, "type");
  if (detailKindForType(type) === "tool") {
    return readToolDetailText(value);
  }

  const direct =
    readStringProperty(value, "text") ||
    readStringProperty(value, "content") ||
    readStringProperty(value, "markdown") ||
    readStringProperty(value, "message") ||
    readStringProperty(value, "result") ||
    readStringProperty(value, "output") ||
    readStringProperty(value, "error");
  if (direct) {
    return stripAnsi(direct);
  }

  const data = readProperty(value, "data");
  if (isRecord(data)) {
    const nested =
      readStringProperty(data, "text") ||
      readStringProperty(data, "content") ||
      readStringProperty(data, "markdown") ||
      readStringProperty(data, "message") ||
      readStringProperty(data, "result") ||
      readStringProperty(data, "output") ||
      readStringProperty(data, "error");
    if (nested) {
      return stripAnsi(nested);
    }
  }

  return "";
}

function shouldIgnoreDetailType(type: string): boolean {
  const normalized = normalizePartType(type);
  return normalized === "stepstart" || normalized === "stepfinish";
}
