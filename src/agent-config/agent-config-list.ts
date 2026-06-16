import { ItemView, Notice, Plugin, setIcon, WorkspaceLeaf } from "obsidian";
import { Dirent } from "node:fs";
import { lstat, readFile, readdir, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { VaultBasePathProvider } from "./types";

export const VIEW_TYPE_AGENT_CONFIG_LIST = "opencode-agent-config-list-view";

type AgentEntry = {
  name: string;
  detail: string;
  openPath: string;
  sortPath: string;
  uninstallPath?: string;
};

type AgentScanResult = {
  agents: AgentEntry[];
  skills: AgentEntry[];
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
]);

export class Agent {
  private rootEl: HTMLElement | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly vaultBasePath: VaultBasePathProvider,
  ) {}

  async render(containerEl: HTMLElement): Promise<void> {
    this.rootEl = containerEl;

    try {
      const result = await this.scan();
      containerEl.empty();
      const contentEl = this.renderFrame(containerEl);
      this.renderSection(contentEl, {
        title: "Skills",
        icon: "sparkles",
        entries: result.skills,
        emptyText: "No skills found in .agents.",
        allowUninstall: true,
      });
      this.renderSection(contentEl, {
        title: "AGENTS.md",
        icon: "bot",
        entries: result.agents,
        emptyText: "No AGENTS.md files found.",
      });
    } catch (error) {
      console.error("Failed to scan agent config", error);
      if (containerEl.childElementCount === 0) {
        const contentEl = this.renderFrame(containerEl);
        contentEl.createDiv({
          cls: "opencode-agent-config-empty",
          text: "Unable to load agent config.",
        });
      }
      new Notice("Unable to load Agent config.");
    }
  }

  private renderFrame(containerEl: HTMLElement): HTMLElement {
    const headerEl = containerEl.createDiv({ cls: "opencode-agent-config-header" });
    headerEl.createDiv({ cls: "opencode-agent-config-title", text: "Agent config" });
    return containerEl.createDiv({ cls: "opencode-agent-config-content" });
  }

  private renderSection(
    containerEl: HTMLElement,
    options: {
      title: string;
      icon: string;
      entries: AgentEntry[];
      emptyText: string;
      allowUninstall?: boolean;
    },
  ): void {
    const sectionEl = containerEl.createDiv({ cls: "opencode-agent-config-section" });
    const headingEl = sectionEl.createDiv({ cls: "opencode-agent-config-section-heading" });
    const iconEl = headingEl.createSpan({ cls: "opencode-agent-config-section-icon" });
    setIcon(iconEl, options.icon);
    headingEl.createSpan({ text: options.title });
    headingEl.createSpan({
      cls: "opencode-agent-config-count",
      text: String(options.entries.length),
    });

    if (options.entries.length === 0) {
      sectionEl.createDiv({
        cls: "opencode-agent-config-empty",
        text: options.emptyText,
      });
      return;
    }

    const listEl = sectionEl.createDiv({ cls: "opencode-agent-config-list" });
    for (const entry of options.entries) {
      const itemEl = listEl.createDiv({
        cls: "opencode-agent-config-item",
        attr: { role: "button", tabindex: "0" },
      });
      itemEl.createDiv({
        cls: "opencode-agent-config-item-name",
        text: entry.name,
      });
      if (entry.detail) {
        itemEl.createDiv({
          cls: "opencode-agent-config-item-path",
          text: entry.detail,
        });
      }
      itemEl.addEventListener("click", () => {
        void this.plugin.app.workspace.openLinkText(entry.openPath, "", false);
      });
      itemEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        void this.plugin.app.workspace.openLinkText(entry.openPath, "", false);
      });

      if (options.allowUninstall && entry.uninstallPath) {
        const actionEl = itemEl.createDiv({ cls: "opencode-agent-config-actions" });
        const uninstallButtonEl = actionEl.createEl("button", {
          cls: "opencode-agent-config-action opencode-agent-config-uninstall",
          attr: {
            "aria-label": `Uninstall ${entry.name}`,
            title: `Uninstall ${entry.name}`,
            type: "button",
          },
        });
        setIcon(uninstallButtonEl, "trash-2");
        uninstallButtonEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.uninstallSkill(entry);
        });
      }
    }
  }

  private async uninstallSkill(entry: AgentEntry): Promise<void> {
    if (!entry.uninstallPath) {
      return;
    }

    try {
      const linkStat = await lstat(entry.uninstallPath);
      if (!linkStat.isSymbolicLink()) {
        new Notice(`Skill "${entry.name}" is not a linked install.`);
        return;
      }

      await unlink(entry.uninstallPath);
      new Notice(`Uninstalled skill "${entry.name}".`);
      if (this.rootEl) {
        await this.render(this.rootEl);
      }
    } catch (error) {
      console.error("Failed to uninstall skill", error);
      new Notice(`Failed to uninstall skill "${entry.name}".`);
    }
  }

  private async scan(): Promise<AgentScanResult> {
    const vaultBasePath = this.vaultBasePath();
    if (!vaultBasePath) {
      throw new Error("Agent config requires a local vault.");
    }

    const vaultRoot = resolve(vaultBasePath);
    const result: AgentScanResult = { agents: [], skills: [] };
    await this.walkAgentFiles(vaultRoot, vaultRoot, new Set(), result.agents);
    await this.walkSkills(join(vaultRoot, ".agents"), vaultRoot, new Set(), result.skills);
    result.agents.sort(compareEntries);
    result.skills.sort(compareEntries);
    return result;
  }

  private async walkAgentFiles(
    absolutePath: string,
    vaultRoot: string,
    visited: Set<string>,
    agents: AgentEntry[],
  ): Promise<void> {
    const entries = await this.readDirectory(absolutePath, visited);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      const childAbsolutePath = join(absolutePath, entry.name);
      const childVaultPath = normalizeVaultPath(relative(vaultRoot, childAbsolutePath));

      if (entry.isFile() && entry.name.toLowerCase() === "agents.md") {
        const parentPath = parentVaultPath(childVaultPath);
        const preview = await readMarkdownPreview(childAbsolutePath, "\n");
        agents.push({
          name: parentPath || "/",
          detail: preview,
          openPath: childVaultPath,
          sortPath: parentPath || "/",
        });
        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await this.walkAgentFiles(childAbsolutePath, vaultRoot, visited, agents);
        continue;
      }

      if (entry.isSymbolicLink()) {
        await this.walkLinkedDirectory(childAbsolutePath, vaultRoot, visited, (path) =>
          this.walkAgentFiles(path, vaultRoot, visited, agents),
        );
      }
    }
  }

  private async walkSkills(
    absolutePath: string,
    vaultRoot: string,
    visited: Set<string>,
    skills: AgentEntry[],
  ): Promise<void> {
    const entries = await this.readDirectory(absolutePath, visited);
    if (!entries) {
      return;
    }

    const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (hasSkillFile) {
      const folderPath = normalizeVaultPath(relative(vaultRoot, absolutePath));
      const realFolderPath = await realpath(absolutePath);
      const openFolderPath = isPathInside(realFolderPath, vaultRoot)
        ? normalizeVaultPath(relative(vaultRoot, realFolderPath))
        : folderPath;
      const skillFilePath = join(realFolderPath, "SKILL.md");
      const skillMeta = await readSkillMetadata(skillFilePath);
      skills.push({
        name: skillMeta.name || basename(absolutePath),
        detail: skillMeta.description,
        openPath: normalizeVaultPath(join(openFolderPath, "SKILL.md")),
        sortPath: folderPath,
        uninstallPath: absolutePath,
      });
    }

    for (const entry of entries) {
      const childAbsolutePath = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        await this.walkSkills(childAbsolutePath, vaultRoot, visited, skills);
        continue;
      }

      if (entry.isSymbolicLink()) {
        await this.walkLinkedDirectory(childAbsolutePath, vaultRoot, visited, (path) =>
          this.walkSkills(path, vaultRoot, visited, skills),
        );
      }
    }
  }

  private async readDirectory(
    absolutePath: string,
    visited: Set<string>,
  ): Promise<Dirent[] | null> {
    try {
      const canonicalPath = await realpath(absolutePath);
      if (visited.has(canonicalPath)) {
        return null;
      }
      visited.add(canonicalPath);
      return await readdir(absolutePath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async walkLinkedDirectory(
    absolutePath: string,
    vaultRoot: string,
    visited: Set<string>,
    walk: (path: string) => Promise<void>,
  ): Promise<void> {
    try {
      const linkStat = await stat(absolutePath);
      if (!linkStat.isDirectory()) {
        return;
      }
      if (!isPathInside(resolve(absolutePath), vaultRoot)) {
        return;
      }
      await walk(absolutePath);
    } catch {
      // Ignore broken links in agent config folders.
    }
  }
}

export class AgentConfigListView extends ItemView {
  private refreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: Plugin,
    private readonly vaultBasePath: VaultBasePathProvider,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_AGENT_CONFIG_LIST;
  }

  getDisplayText(): string {
    return "Agent config";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    const containerEl = this.containerEl.children[1] as HTMLElement;
    containerEl.empty();
    containerEl.addClass("opencode-agent-config-view");

    this.registerEvent(this.plugin.app.vault.on("create", () => this.scheduleRender()));
    this.registerEvent(this.plugin.app.vault.on("delete", () => this.scheduleRender()));
    this.registerEvent(this.plugin.app.vault.on("modify", () => this.scheduleRender()));
    this.registerEvent(this.plugin.app.vault.on("rename", () => this.scheduleRender()));

    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.containerEl.empty();
  }

  refresh(): void {
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.render();
    }, 100);
  }

  private async render(): Promise<void> {
    const containerEl = this.containerEl.children[1] as HTMLElement;
    if (!containerEl) {
      return;
    }

    await new Agent(this.plugin, this.vaultBasePath).render(containerEl);
  }
}

function normalizeVaultPath(path: string): string {
  return path
    .split(sep)
    .join("/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function isPathInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareEntries(a: AgentEntry, b: AgentEntry): number {
  return a.sortPath.localeCompare(b.sortPath);
}

function parentVaultPath(path: string): string {
  const parent = dirname(path);
  return parent === "." ? "" : normalizeVaultPath(parent);
}

async function readSkillMetadata(path: string): Promise<{ name: string; description: string }> {
  try {
    const content = await readFile(path, "utf8");
    return {
      name: extractFrontmatterValue(content, "name"),
      description: extractFrontmatterValue(content, "description") || extractMarkdownPreview(content) || "No description.",
    };
  } catch {
    return { name: "", description: "No description." };
  }
}

async function readMarkdownPreview(path: string, separator = " "): Promise<string> {
  try {
    return extractMarkdownPreview(await readFile(path, "utf8"), separator);
  } catch {
    return "";
  }
}

function extractFrontmatterValue(content: string, key: string): string {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return "";
  }

  const valueMatch = frontmatterMatch[1].match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "m"));
  if (!valueMatch) {
    return "";
  }

  return cleanSummaryLine(valueMatch[1]);
}

function extractMarkdownPreview(content: string, separator = " "): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  return withoutFrontmatter
    .split(/\r?\n/)
    .map(cleanSummaryLine)
    .filter(Boolean)
    .slice(0, 3)
    .join(separator);
}

function cleanSummaryLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
