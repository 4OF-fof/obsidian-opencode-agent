import { setIcon } from "obsidian";
import { PickerMenuConfig, PickerOption } from "./view-types";
import { sortSelectedFirst } from "./view-utils";

interface PickerMenuCallbacks {
  currentFavoriteValuesFor: (config: PickerMenuConfig) => string[];
  closePickerMenu: () => void;
}

export function setPickerButtonContent(buttonEl: HTMLButtonElement, label: string): void {
  buttonEl.empty();
  buttonEl.createSpan({ cls: "opencode-chat-picker-label", text: label });
  const iconEl = buttonEl.createSpan({ cls: "opencode-chat-picker-chevron" });
  setIcon(iconEl, "chevron-down");
}

export function renderPickerMenuContents(
  menuEl: HTMLElement,
  config: PickerMenuConfig,
  callbacks: PickerMenuCallbacks,
): void {
  menuEl.empty();
  const newSessionOption = config.kind === "session" ? config.options.find((option) => option.value === "") : undefined;
  const sectionOptions = newSessionOption ? config.options.filter((option) => option.value !== "") : config.options;
  const favoriteValues = new Set(config.favoriteValues);
  const favoriteOptions = sortSelectedFirst(
    sectionOptions.filter((option) => favoriteValues.has(option.value)),
    config.selectedValue,
  );
  const allOptions = sortSelectedFirst(
    sectionOptions.filter((option) => !favoriteValues.has(option.value)),
    config.selectedValue,
  );

  if (newSessionOption) {
    renderPickerSection(menuEl, "", [newSessionOption], config, callbacks);
    if (sectionOptions.length > 0) {
      menuEl.createDiv({ cls: "opencode-chat-picker-divider" });
    }
  }

  if (favoriteOptions.length > 0) {
    renderPickerSection(menuEl, "お気に入り", favoriteOptions, config, callbacks);
  }

  if (allOptions.length > 0) {
    renderPickerSection(menuEl, "すべてのオプション", allOptions, config, callbacks);
  }
}

function renderPickerSection(
  menuEl: HTMLElement,
  title: string,
  options: PickerOption[],
  config: PickerMenuConfig,
  callbacks: PickerMenuCallbacks,
): void {
  if (title) {
    menuEl.createDiv({ cls: "opencode-chat-picker-section", text: title });
  }

  for (const option of options) {
    const isNewSession = config.kind === "session" && option.value === "";
    const itemEl = menuEl.createDiv({
      cls: `opencode-chat-picker-item${isNewSession ? " opencode-chat-picker-item-new" : ""}`,
      attr: { role: "button", tabindex: "0" },
    });
    if (isNewSession) {
      const newIconEl = itemEl.createSpan({ cls: "opencode-chat-picker-item-leading-icon" });
      setIcon(newIconEl, "plus");
    }
    itemEl.createSpan({ cls: "opencode-chat-picker-item-label", text: option.label });

    if (!isNewSession) {
      const selectedIconEl = itemEl.createSpan({ cls: "opencode-chat-picker-item-icon" });
      if (option.value === config.selectedValue) {
        setIcon(selectedIconEl, "check");
      } else {
        selectedIconEl.addClass("is-empty");
      }
    }

    if (config.allowFavorite(option.value)) {
      const favoriteButtonEl = itemEl.createEl("button", {
        cls: "opencode-chat-picker-favorite",
        attr: { type: "button", "aria-label": "お気に入りを切り替え" },
      });
      setIcon(favoriteButtonEl, "star");
      favoriteButtonEl.toggleClass("is-favorite", config.favoriteValues.includes(option.value));
      favoriteButtonEl.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await config.onToggleFavorite(option.value, !config.favoriteValues.includes(option.value));
        renderPickerMenuContents(menuEl, {
          ...config,
          favoriteValues: callbacks.currentFavoriteValuesFor(config),
        }, callbacks);
      });
    } else if (!isNewSession) {
      itemEl.createSpan({ cls: "opencode-chat-picker-favorite-placeholder" });
    }

    itemEl.addEventListener("click", async () => {
      await config.onSelect(option.value);
      callbacks.closePickerMenu();
    });
    itemEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      void config.onSelect(option.value).then(() => callbacks.closePickerMenu());
    });
  }
}
