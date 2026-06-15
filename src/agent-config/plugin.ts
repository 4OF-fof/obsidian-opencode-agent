import { Plugin } from "obsidian";
import { AgentFileIcons } from "./agent-file-icons";
import { SkillInstaller } from "./skill-installer";
import { VaultBasePathProvider } from "./types";

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
      () => this.agentFileIcons.refresh(),
    );
  }

  onload(): void {
    this.skillInstaller.onload();
    this.agentFileIcons.onload();
  }
}
