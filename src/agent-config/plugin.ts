import { Notice, Plugin } from "obsidian";
import { AgentFileIcons } from "./agent-file-icons";
import { SkillInstaller } from "./skill-installer";
import { VaultBasePathProvider } from "./types";
import { AgentConfigListView, VIEW_TYPE_AGENT_CONFIG_LIST } from "./agent-config-list";

export class AgentConfigManager {
  private readonly agentFileIcons: AgentFileIcons;
  private readonly skillInstaller: SkillInstaller;

  constructor(
    private readonly plugin: Plugin,
    private readonly vaultBasePath: VaultBasePathProvider,
  ) {
    this.agentFileIcons = new AgentFileIcons(this.plugin);
    this.skillInstaller = new SkillInstaller(
      this.plugin,
      this.vaultBasePath,
      () => {
        this.agentFileIcons.refresh();
        this.refreshViews();
      },
    );
  }

  onload(): void {
    this.plugin.registerView(
      VIEW_TYPE_AGENT_CONFIG_LIST,
      (leaf) => new AgentConfigListView(leaf, this.plugin, this.vaultBasePath),
    );

    this.plugin.addRibbonIcon("bot", "Agent config", () => {
      void this.activateView();
    });

    this.plugin.addCommand({
      id: "open-agent-config",
      name: "Open Agent config",
      callback: () => {
        void this.activateView();
      },
    });

    this.skillInstaller.onload();
    this.agentFileIcons.onload();
  }

  onunload(): void {
    this.plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_AGENT_CONFIG_LIST);
  }

  async activateView(): Promise<void> {
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_CONFIG_LIST);
    if (leaves.length === 0) {
      const leaf = this.plugin.app.workspace.getRightLeaf(false);
      if (!leaf) {
        new Notice("Unable to open Agent config.");
        return;
      }

      await leaf.setViewState({
        type: VIEW_TYPE_AGENT_CONFIG_LIST,
        active: true,
      });
    } else {
      await leaves[0].setViewState({
        type: VIEW_TYPE_AGENT_CONFIG_LIST,
        active: true,
      });
    }

    const leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_CONFIG_LIST)[0];
    if (leaf) {
      this.plugin.app.workspace.revealLeaf(leaf);
    } else {
      new Notice("Unable to open Agent config.");
    }
  }

  private refreshViews(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_CONFIG_LIST)) {
      const view = leaf.view;
      if (view instanceof AgentConfigListView) {
        view.refresh();
      }
    }
  }
}
