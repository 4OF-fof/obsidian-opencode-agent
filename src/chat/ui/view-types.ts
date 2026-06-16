import {
  OpenCodeQuestionRequest,
  OpenCodeQuestionResolution,
  ReasoningEffort,
} from "../shared/types";

export interface PickerOption {
  value: string;
  label: string;
  effortOptions?: ReasoningEffort[];
}

export interface ActiveChatRequest {
  id: number;
  interrupted: boolean;
}

export interface ActiveQuestion {
  request: OpenCodeQuestionRequest;
  currentIndex: number;
  selections: string[][];
  customValues: string[];
  submitting: boolean;
  resolve: (resolution: OpenCodeQuestionResolution) => void;
}

export interface PickerMenuConfig {
  kind: "model" | "effort" | "session";
  options: PickerOption[];
  selectedValue: string;
  favoriteValues: string[];
  allowFavorite: (value: string) => boolean;
  onSelect: (value: string) => Promise<void>;
  onToggleFavorite: (value: string, enabled: boolean) => Promise<void>;
}

export const DEFAULT_INPUT_PLACEHOLDER = "opencode にメッセージ...";
