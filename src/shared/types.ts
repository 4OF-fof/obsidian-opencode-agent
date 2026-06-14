export interface OpenCodeChatSettings {
  serverAddress: string;
  opencodeCommand: string;
  providerID: string;
  modelID: string;
  reasoningEffort: ReasoningEffort;
  visibleModelIDs: string[];
  favoriteReasoningEffortsByModel: Record<string, ReasoningEffort[]>;
}

export const DEFAULT_SETTINGS: OpenCodeChatSettings = {
  serverAddress: "127.0.0.1:4097",
  opencodeCommand: "opencode",
  providerID: "",
  modelID: "",
  reasoningEffort: "",
  visibleModelIDs: [],
  favoriteReasoningEffortsByModel: {},
};

export type ReasoningEffort = string;

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  details?: ChatMessageDetail[];
}

export interface ChatMessageDetail {
  kind: "reasoning" | "tool" | "other";
  title: string;
  text: string;
}

export interface OpenCodeModelOption {
  providerID: string;
  modelID: string;
  label: string;
  effortOptions: ReasoningEffort[];
}

export interface ServerAddress {
  host: string;
  port: number;
}
