export type JsonRecord = Record<string, unknown>;

export function readProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function readStringProperty(value: unknown, key: string): string {
  const property = readProperty(value, key);
  return typeof property === "string" ? property : "";
}

export function readArrayProperty(value: unknown, key: string): unknown[] {
  const property = readProperty(value, key);
  return Array.isArray(property) ? property : [];
}

export function readModelMap(value: unknown, key: string): JsonRecord[] {
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

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function normalizePartType(type: string): string {
  return type.toLowerCase().replace(/[_-]/g, "");
}

export function formatDetailValue(value: unknown): string {
  if (typeof value === "string") {
    return stripAnsi(value);
  }

  if (value === undefined || value === null) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
}
