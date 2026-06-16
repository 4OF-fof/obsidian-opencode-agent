import { requestUrl, RequestUrlParam } from "obsidian";
import { parseServerAddress } from "./address";
import {
  JsonRecord,
  isRecord,
  readArrayProperty,
  readBooleanProperty,
  readProperty,
  readStringProperty,
} from "./json";
import {
  AssistantUpdateHandler,
  OpenCodeAssistantResponse,
  assistantMessagesAfter,
  extractChatMessages,
  extractAssistantResponse,
  isCompletedAssistantMessageRecord,
  isFinalAssistantMessage,
} from "./messages";
import { extractModelOptions } from "./models";
import {
  ChatMessage,
  OpenCodeChatSettings,
  OpenCodeModelOption,
  OpenCodeQuestionAnswer,
  OpenCodeQuestionInfo,
  OpenCodeQuestionOption,
  OpenCodeQuestionRequest,
  OpenCodeQuestionResolution,
  OpenCodeQuestionSourceRequest,
  OpenCodeSessionOption,
} from "../shared/types";

export { OpenCodeAssistantResponse } from "./messages";

const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 500;

export type QuestionResponseHandler = (request: OpenCodeQuestionRequest) => Promise<OpenCodeQuestionResolution>;

export class OpenCodeClient {
  constructor(private readonly settings: OpenCodeChatSettings) {}

  async health(): Promise<{ healthy: boolean; version?: string }> {
    return await this.requestJson<{ healthy: boolean; version?: string }>("/global/health");
  }

  async listModels(): Promise<OpenCodeModelOption[]> {
    const response = await this.requestJson<unknown>("/provider");
    return extractModelOptions(response);
  }

  async listSessions(vaultPath?: string): Promise<OpenCodeSessionOption[]> {
    const response = await this.requestJson<unknown>("/session");
    return extractSessionOptions(response, vaultPath);
  }

  async createSession(title: string): Promise<string> {
    const response = await this.requestJson<unknown>("/session", {
      method: "POST",
      body: JSON.stringify({ title }),
    });

    const id = readStringProperty(response, "id");
    if (!id) {
      throw new Error("opencode がセッション ID を返しませんでした。");
    }

    return id;
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<OpenCodeSessionOption> {
    const response = await this.requestJson<unknown>(`/session/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    return extractSessionOptions([response])[0] ?? {
      id: sessionId,
      title,
      path: "",
      updatedAt: 0,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.requestJson<void>(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async listSessionChatMessages(sessionId: string): Promise<ChatMessage[]> {
    return extractChatMessages(await this.listSessionMessages(sessionId));
  }

  async sendMessage(
    sessionId: string,
    text: string,
    onUpdate?: AssistantUpdateHandler,
    onQuestion?: QuestionResponseHandler,
  ): Promise<OpenCodeAssistantResponse> {
    const previousMessages = await this.listSessionMessages(sessionId);

    await this.requestJson<unknown>(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: "POST",
      body: JSON.stringify(this.messageBody(text)),
    });

    const response = await this.waitForAssistantResponse(sessionId, previousMessages.length, onUpdate, onQuestion);
    return extractAssistantResponse(response);
  }

  async listSessionQuestions(sessionId: string): Promise<OpenCodeQuestionRequest[]> {
    const responses = await Promise.all([
      this.requestJson<unknown>(`/api/session/${encodeURIComponent(sessionId)}/question`).catch(() => null),
      this.requestJson<unknown>("/question").catch(() => null),
    ]);
    return dedupeQuestionRequests(
      responses.flatMap((response) => response === null ? [] : extractQuestionRequests(response, sessionId)),
    );
  }

  async replyQuestion(
    sessionId: string,
    requestId: string,
    answers: OpenCodeQuestionAnswer[],
  ): Promise<void> {
    const body = JSON.stringify({ answers });

    try {
      await this.requestJson<void>(
        `/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestId)}/reply`,
        { method: "POST", body },
      );
      return;
    } catch {
      await this.requestJson<void>(
        `/question/${encodeURIComponent(requestId)}/reply`,
        { method: "POST", body },
      );
    }
  }

  async rejectQuestion(sessionId: string, requestId: string): Promise<void> {
    try {
      await this.requestJson<void>(
        `/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestId)}/reject`,
        { method: "POST" },
      );
      return;
    } catch {
      await this.requestJson<void>(
        `/question/${encodeURIComponent(requestId)}/reject`,
        { method: "POST" },
      );
    }
  }

  private async listSessionMessages(sessionId: string): Promise<unknown[]> {
    return await this.requestJson<unknown[]>(`/session/${encodeURIComponent(sessionId)}/message`);
  }

  private async waitForAssistantResponse(
    sessionId: string,
    previousMessageCount: number,
    onUpdate?: AssistantUpdateHandler,
    onQuestion?: QuestionResponseHandler,
  ): Promise<unknown[]> {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    let previousSnapshot = "";
    const handledQuestionIds = new Set<string>();

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

      if (onQuestion) {
        const question = await this.nextPendingQuestion(sessionId, handledQuestionIds);
        if (question) {
          for (const source of questionSourceRequests(question)) {
            handledQuestionIds.add(source.id);
          }
          const resolution = await onQuestion(question);
          if (resolution.type === "reply") {
            await this.replyQuestionRequest(sessionId, question, resolution.answers);
          } else {
            await this.rejectQuestionRequest(sessionId, question);
          }
          previousSnapshot = "";
          continue;
        }
      }

      const completedMessages = assistantMessages.filter(isCompletedAssistantMessageRecord);
      if (completedMessages.some(isFinalAssistantMessage)) {
        return completedMessages;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`opencode の応答待機が ${Math.round(RESPONSE_TIMEOUT_MS / 1000)} 秒でタイムアウトしました。`);
  }

  private async nextPendingQuestion(
    sessionId: string,
    handledQuestionIds: Set<string>,
  ): Promise<OpenCodeQuestionRequest | null> {
    const questions = await this.listSessionQuestions(sessionId).catch((): OpenCodeQuestionRequest[] => []);
    return combineQuestionRequests(questions.filter((question) => !handledQuestionIds.has(question.id)));
  }

  private async replyQuestionRequest(
    sessionId: string,
    request: OpenCodeQuestionRequest,
    answers: OpenCodeQuestionAnswer[],
  ): Promise<void> {
    let answerOffset = 0;
    for (const source of questionSourceRequests(request)) {
      const sourceAnswers = answers.slice(answerOffset, answerOffset + source.questionCount);
      answerOffset += source.questionCount;
      await this.replyQuestion(sessionId, source.id, sourceAnswers);
    }
  }

  private async rejectQuestionRequest(sessionId: string, request: OpenCodeQuestionRequest): Promise<void> {
    for (const source of questionSourceRequests(request)) {
      await this.rejectQuestion(sessionId, source.id);
    }
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

function extractSessionOptions(value: unknown, vaultPath?: string): OpenCodeSessionOption[] {
  const records = readSessionRecords(value);
  const normalizedVaultPath = vaultPath ? normalizePath(vaultPath) : "";
  const hasPathMetadata = records.some((record) => readSessionPath(record));

  return records
    .map((record) => {
      const id = readStringProperty(record, "id");
      if (!id) {
        return null;
      }

      const path = readSessionPath(record);
      if (normalizedVaultPath && hasPathMetadata && !isPathInVault(path, normalizedVaultPath)) {
        return null;
      }

      return {
        id,
        title: readSessionTitle(record) || id,
        path,
        updatedAt: readSessionUpdatedAt(record),
      };
    })
    .filter((session): session is OpenCodeSessionOption => session !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function extractQuestionRequests(value: unknown, sessionId?: string): OpenCodeQuestionRequest[] {
  const records = readQuestionRecords(value);
  return records
    .map((record) => readQuestionRequest(record))
    .filter((request): request is OpenCodeQuestionRequest => request !== null)
    .filter((request) => !sessionId || request.sessionID === sessionId);
}

function combineQuestionRequests(requests: OpenCodeQuestionRequest[]): OpenCodeQuestionRequest | null {
  const pending = requests.filter((request) => request.questions.length > 0);
  if (pending.length === 0) {
    return null;
  }

  if (pending.length === 1) {
    return pending[0];
  }

  return {
    id: pending.map((request) => request.id).join(","),
    sessionID: pending[0].sessionID,
    questions: pending.flatMap((request) => request.questions),
    sourceRequests: pending.map((request) => ({
      id: request.id,
      questionCount: request.questions.length,
    })),
  };
}

function dedupeQuestionRequests(requests: OpenCodeQuestionRequest[]): OpenCodeQuestionRequest[] {
  const seen = new Set<string>();
  const deduped: OpenCodeQuestionRequest[] = [];

  for (const request of requests) {
    if (seen.has(request.id)) {
      continue;
    }

    seen.add(request.id);
    deduped.push(request);
  }

  return deduped;
}

function questionSourceRequests(request: OpenCodeQuestionRequest): OpenCodeQuestionSourceRequest[] {
  return request.sourceRequests ?? [{ id: request.id, questionCount: request.questions.length }];
}

function readQuestionRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (isQuestionRequestRecord(value)) {
    return [value];
  }

  const dataValue = readProperty(value, "data");
  if (isQuestionRequestRecord(dataValue)) {
    return [dataValue];
  }

  const data = readArrayProperty(value, "data");
  if (data.length > 0) {
    return data;
  }

  const questions = readArrayProperty(value, "questions");
  return questions.length > 0 ? questions : [];
}

function isQuestionRequestRecord(value: unknown): boolean {
  return Boolean(readStringProperty(value, "id") && readQuestionSessionId(value));
}

function readQuestionRequest(value: unknown): OpenCodeQuestionRequest | null {
  const id = readStringProperty(value, "id");
  const sessionID = readQuestionSessionId(value);
  if (!id || !sessionID) {
    return null;
  }

  const nestedQuestions = readArrayProperty(value, "questions").map(readQuestionInfo).filter(isQuestionInfo);
  const directQuestion = readQuestionInfo(value);
  return {
    id,
    sessionID,
    questions: nestedQuestions.length > 0
      ? nestedQuestions
      : isQuestionInfo(directQuestion)
        ? [directQuestion]
        : [],
  };
}

function readQuestionInfo(value: unknown): OpenCodeQuestionInfo {
  return {
    question: readStringProperty(value, "question"),
    header: readStringProperty(value, "header"),
    options: readArrayProperty(value, "options").map(readQuestionOption).filter(isQuestionOption),
    multiple: readBooleanProperty(value, "multiple"),
    custom: readBooleanProperty(value, "custom"),
  };
}

function readQuestionOption(value: unknown): OpenCodeQuestionOption {
  if (typeof value === "string") {
    return {
      label: value,
      description: "",
    };
  }

  return {
    label: readStringProperty(value, "label"),
    description: readStringProperty(value, "description"),
  };
}

function readQuestionSessionId(value: unknown): string {
  return (
    readStringProperty(value, "sessionID") ||
    readStringProperty(value, "sessionId") ||
    readStringProperty(value, "session_id")
  );
}

function isQuestionInfo(value: OpenCodeQuestionInfo): boolean {
  return Boolean(value.question || value.header || value.options.length > 0 || value.custom);
}

function isQuestionOption(value: OpenCodeQuestionOption): boolean {
  return Boolean(value.label);
}

function readSessionRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const sessions = readArrayProperty(value, "sessions");
  if (sessions.length > 0) {
    return sessions;
  }

  const data = readArrayProperty(value, "data");
  if (data.length > 0) {
    return data;
  }

  const items = readArrayProperty(value, "items");
  return items.length > 0 ? items : [];
}

function readSessionTitle(value: unknown): string {
  const title =
    readStringProperty(value, "title") ||
    readStringProperty(value, "name") ||
    readStringProperty(readProperty(value, "info"), "title");
  return title.trim();
}

function readSessionPath(value: unknown): string {
  const direct =
    readStringProperty(value, "cwd") ||
    readStringProperty(value, "directory") ||
    readStringProperty(value, "path") ||
    readStringProperty(value, "workspace");
  if (direct) {
    return direct;
  }

  const project = readProperty(value, "project");
  if (isRecord(project)) {
    return (
      readStringProperty(project, "cwd") ||
      readStringProperty(project, "directory") ||
      readStringProperty(project, "path") ||
      readStringProperty(project, "workspace")
    );
  }

  return "";
}

function readSessionUpdatedAt(value: unknown): number {
  const direct =
    readTimeValue(readProperty(value, "updatedAt")) ||
    readTimeValue(readProperty(value, "updated")) ||
    readTimeValue(readProperty(value, "createdAt")) ||
    readTimeValue(readProperty(value, "created"));
  if (direct > 0) {
    return direct;
  }

  const time = readProperty(readProperty(value, "info"), "time") ?? readProperty(value, "time");
  return (
    readTimeValue(readProperty(time, "updated")) ||
    readTimeValue(readProperty(time, "created")) ||
    0
  );
}

function readTimeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPathInVault(path: string, normalizedVaultPath: string): boolean {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === normalizedVaultPath || normalizedPath.startsWith(`${normalizedVaultPath}/`)) {
    return true;
  }

  const pathSegments = normalizedPath.split("/").filter(Boolean);
  return pathSegments.length > 1 && normalizedVaultPath.endsWith(`/${normalizedPath}`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
