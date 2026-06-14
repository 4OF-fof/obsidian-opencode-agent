export interface OpenCodeChatSettings {
  serverAddress: string;
  opencodeCommand: string;
  providerID: string;
  modelID: string;
  reasoningEffort: ReasoningEffort;
  visibleModelIDs: string[];
  visibleReasoningEfforts: ReasoningEffort[];
  favoriteReasoningEffortsByModel: Record<string, ReasoningEffort[]>;
}

export const DEFAULT_SETTINGS: OpenCodeChatSettings = {
  serverAddress: "localhost:4096",
  opencodeCommand: "opencode",
  providerID: "",
  modelID: "",
  reasoningEffort: "",
  visibleModelIDs: [],
  visibleReasoningEfforts: [],
  favoriteReasoningEffortsByModel: {},
};

export type ReasoningEffort = string;

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string; settingValue: string }> = [
  { value: "none", label: "none", settingValue: "none" },
  { value: "minimal", label: "minimal", settingValue: "minimal" },
  { value: "low", label: "low", settingValue: "low" },
  { value: "medium", label: "medium", settingValue: "medium" },
  { value: "high", label: "high", settingValue: "high" },
  { value: "xhigh", label: "xhigh", settingValue: "xhigh" },
  { value: "max", label: "max", settingValue: "max" },
  { value: "thinking", label: "thinking", settingValue: "thinking" },
];

export interface ChatMessage {
  role: "user" | "assistant" | "error";
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
