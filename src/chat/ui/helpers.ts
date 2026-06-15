import { ReasoningEffort } from "../shared/types";

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function selectedModelValue(providerID: string, modelID: string): string {
  return providerID && modelID ? `${providerID}/${modelID}` : "";
}

export function effortLabel(value: ReasoningEffort): string {
  return value || "default";
}

export function updateStringFavorite(values: string[], value: string, enabled: boolean): string[] {
  if (enabled) {
    return values.includes(value) ? values : [...values, value];
  }

  return values.filter((entry) => entry !== value);
}

export function updateEffortFavorite(
  values: ReasoningEffort[],
  value: ReasoningEffort,
  enabled: boolean,
): ReasoningEffort[] {
  if (enabled) {
    return values.includes(value) ? values : [...values, value];
  }

  return values.filter((entry) => entry !== value);
}
