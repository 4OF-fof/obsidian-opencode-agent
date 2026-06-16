import { Plugin, setIcon, TFile, TFolder } from "obsidian";

export class AgentFileIcons {
  private fileExplorerObserver: MutationObserver | null = null;

  constructor(private readonly plugin: Plugin) {}

  onload(): void {
    this.plugin.app.workspace.onLayoutReady(() => {
      this.start();
    });

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        this.start();
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", () => {
        this.scheduleRefresh();
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", () => {
        this.scheduleRefresh();
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", () => {
        this.scheduleRefresh();
      }),
    );
  }

  refresh(): void {
    this.scheduleRefresh();
  }

  private start(): void {
    this.stop();

    const fileExplorerEl = document.querySelector(".workspace-leaf-content[data-type='file-explorer']");
    if (!fileExplorerEl) {
      return;
    }

    this.refreshIcons();

    this.fileExplorerObserver = new MutationObserver(() => {
      this.refreshIcons();
    });
    this.fileExplorerObserver.observe(fileExplorerEl, {
      childList: true,
      subtree: true,
    });

    this.plugin.register(() => this.stop());
  }

  private stop(): void {
    this.fileExplorerObserver?.disconnect();
    this.fileExplorerObserver = null;
  }

  private scheduleRefresh(): void {
    window.setTimeout(() => this.refreshIcons(), 0);
  }

  private refreshIcons(): void {
    const agentPaths = new Set(this.listAgentFiles().map((file) => file.path));
    const skillFolderPaths = new Set(this.listSkillFolders().map((folder) => folder.path));
    const fileTitleEls = document.querySelectorAll<HTMLElement>(".nav-file-title[data-path]");
    const folderTitleEls = document.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]");

    for (const titleEl of fileTitleEls) {
      this.updateTitleIcon(titleEl, {
        paths: agentPaths,
        contentSelector: ".nav-file-title-content",
        icon: "bot",
      });
    }

    for (const titleEl of folderTitleEls) {
      this.updateTitleIcon(titleEl, {
        paths: skillFolderPaths,
        contentSelector: ".nav-folder-title-content",
        icon: "sparkles",
      });
    }
  }

  private updateTitleIcon(
    titleEl: HTMLElement,
    options: {
      paths: Set<string>;
      contentSelector: string;
      icon: string;
    },
  ): void {
    const path = titleEl.dataset.path;
    const iconEl = titleEl.querySelector(".opencode-agent-config-file-icon");

    if (this.isEditingTitle(titleEl)) {
      iconEl?.remove();
      return;
    }

    if (!path || !options.paths.has(path)) {
      iconEl?.remove();
      return;
    }

    if (iconEl) {
      return;
    }

    const titleContentEl = titleEl.querySelector(options.contentSelector);
    if (!titleContentEl) {
      return;
    }

    const agentIconEl = createSpan({
      cls: "opencode-agent-config-file-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(agentIconEl, options.icon);
    titleContentEl.prepend(agentIconEl);
  }

  private isEditingTitle(titleEl: HTMLElement): boolean {
    return Boolean(
      titleEl.querySelector("input, textarea, [contenteditable='true']"),
    );
  }

  private listAgentFiles(): TFile[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) => file.name.toLowerCase() === "agents.md")
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private listSkillFolders(): TFolder[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) => file.name === "SKILL.md" && file.parent)
      .map((file) => file.parent as TFolder)
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}
