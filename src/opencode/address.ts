import { ServerAddress } from "../shared/types";

export function parseServerAddress(value: string): ServerAddress {
  const input = value.trim() || "127.0.0.1:4097";
  const withScheme = input.includes("://") ? input : `http://${input}`;
  const url = new URL(withScheme);
  const port = Number.parseInt(url.port || "4097", 10);

  return {
    host: url.hostname || "localhost",
    port: Number.isFinite(port) ? port : 4097,
  };
}
