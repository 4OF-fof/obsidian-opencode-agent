import { ServerAddress } from "./types";

export function parseServerAddress(value: string): ServerAddress {
  const input = value.trim() || "localhost:4096";
  const withScheme = input.includes("://") ? input : `http://${input}`;
  const url = new URL(withScheme);
  const port = Number.parseInt(url.port || "4096", 10);

  return {
    host: url.hostname || "localhost",
    port: Number.isFinite(port) ? port : 4096,
  };
}

export function normalizeServerAddress(value: string): string {
  const address = parseServerAddress(value);
  return `${address.host}:${address.port}`;
}
