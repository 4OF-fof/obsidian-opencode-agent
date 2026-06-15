import { OpenCodeModelOption, ReasoningEffort } from "../shared/types";
import { JsonRecord, isRecord, isString, readArrayProperty, readModelMap, readProperty, readStringProperty } from "./json";

export function extractModelOptions(value: unknown): OpenCodeModelOption[] {
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
