import { lstat, mkdir, readlink, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Menu, Notice, Plugin, TAbstractFile, TFolder } from "obsidian";
import { VaultBasePathProvider } from "./types";

export class SkillInstaller {
  constructor(
    private readonly plugin: Plugin,
    private readonly vaultBasePath: VaultBasePathProvider,
    private readonly onInstall?: () => void,
  ) {}

  onload(): void {
    this.plugin.registerEvent(
      this.plugin.app.workspace.on("file-menu", (menu, file) => {
        this.addInstallMenuItem(menu, file);
      }),
    );
  }

  private addInstallMenuItem(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFolder) || !this.folderHasDirectSkillFile(file)) {
      return;
    }

    menu.addItem((item) => {
      item
        .setTitle("Install SKILL")
        .setIcon("download")
        .onClick(() => {
          void this.installSkill(file);
        });
    });
  }

  private folderHasDirectSkillFile(folder: TFolder): boolean {
    return folder.children.some((child) => child.name === "SKILL.md");
  }

  private async installSkill(folder: TFolder): Promise<void> {
    const vaultBasePath = this.vaultBasePath();
    if (!vaultBasePath) {
      new Notice("Install skill requires a local vault.");
      return;
    }

    const sourcePath = join(vaultBasePath, folder.path);
    const skillsDir = join(vaultBasePath, ".agents", "skills");
    const linkPath = join(skillsDir, folder.name);

    try {
      await mkdir(skillsDir, { recursive: true });

      const existingLink = await this.readExistingSkillLink(linkPath);
      if (existingLink) {
        if (existingLink === sourcePath) {
          new Notice(`Skill "${folder.name}" is already installed.`);
        } else {
          new Notice(
            `A skill named "${folder.name}" already exists in .agents/skills.`,
          );
        }
        return;
      }

      const relativeTarget = relative(dirname(linkPath), sourcePath);
      await symlink(relativeTarget, linkPath, "dir");
      new Notice(`Installed skill "${folder.name}".`);
      this.onInstall?.();
    } catch (error) {
      console.error("Failed to install skill", error);
      new Notice(`Failed to install skill "${folder.name}".`);
    }
  }

  private async readExistingSkillLink(
    linkPath: string,
  ): Promise<string | null> {
    try {
      const stat = await lstat(linkPath);
      if (!stat.isSymbolicLink()) {
        return linkPath;
      }

      const target = await readlink(linkPath);
      return resolve(dirname(linkPath), target);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }
}
