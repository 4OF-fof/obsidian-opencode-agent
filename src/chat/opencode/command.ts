import { execFile } from "node:child_process";

export async function detectOpenCodeCommand(command = "opencode"): Promise<string> {
  if (process.platform === "win32") {
    return await execFileText("where.exe", [command]);
  }

  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  return await execFileText(shell, ["-lc", `command -v ${shellQuote(command)}`]);
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      const output = stdout.toString().split(/\r?\n/).find((line) => line.trim());
      if (error || !output) {
        reject(new Error(stderr.toString().trim() || error?.message || `${args.at(-1) ?? file} was not found.`));
        return;
      }

      resolve(output.trim());
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
