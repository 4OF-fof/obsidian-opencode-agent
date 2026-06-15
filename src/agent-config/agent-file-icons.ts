import { Plugin, setIcon, TFile } from "obsidian";

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
    const fileTitleEls = document.querySelectorAll<HTMLElement>(".nav-file-title[data-path]");

    for (const titleEl of fileTitleEls) {
      this.updateFileTitleIcon(titleEl, agentPaths);
    }
  }

  private updateFileTitleIcon(titleEl: HTMLElement, agentPaths: Set<string>): void {
    const path = titleEl.dataset.path;
    titleEl.querySelector(".opencode-agent-config-file-label")?.remove();
    titleEl.removeClass("opencode-agent-config-special-file");
    const iconEl = titleEl.querySelector(".opencode-agent-config-file-icon");

    if (!path || !agentPaths.has(path)) {
      iconEl?.remove();
      return;
    }

    if (iconEl) {
      return;
    }

    const titleContentEl = titleEl.querySelector(".nav-file-title-content");
    if (!titleContentEl) {
      return;
    }

    const agentIconEl = createSpan({
      cls: "opencode-agent-config-file-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(agentIconEl, "bot");
    titleContentEl.prepend(agentIconEl);
  }

  private listAgentFiles(): TFile[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((file) => file.name === "AGENTS.md")
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}
