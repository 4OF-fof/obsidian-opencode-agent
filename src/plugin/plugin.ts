import { AgentConfigManager } from "../agent-config/plugin";
import OpenCodeChatPlugin from "../chat/plugin";

export default class OpenCodeAgentPlugin extends OpenCodeChatPlugin {
  private readonly agentConfigManager = new AgentConfigManager(this, () => this.vaultBasePath());

  async onload(): Promise<void> {
    await super.onload();
    this.agentConfigManager.onload();
  }
}
