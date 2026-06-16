import { setIcon } from "obsidian";
import { OpenCodeSessionOption } from "../shared/types";
import { formatSessionTime } from "./view-utils";

interface SessionHistoryCallbacks {
  currentSessionId: () => string;
  onCancelRename: () => void;
  onDelete: (session: OpenCodeSessionOption) => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onSelect: (sessionId: string) => void;
}

export function renderSessionHistory(
  containerEl: HTMLElement,
  sessions: OpenCodeSessionOption[],
  callbacks: SessionHistoryCallbacks,
): void {
  containerEl.empty();

  if (sessions.length === 0) {
    containerEl.createDiv({ cls: "opencode-session-history-empty", text: "この保管庫にはセッションがありません。" });
    return;
  }

  for (const session of sessions) {
    const itemEl = containerEl.createDiv({
      cls: "opencode-session-history-item",
      attr: { role: "button", tabindex: "0", "data-session-id": session.id },
    });
    renderSessionHistoryItemContent(itemEl, session.title, formatSessionTime(session.updatedAt));
    addSessionActionButtons(itemEl, session, callbacks);
    bindSessionHistoryItem(itemEl, session.id, callbacks.onSelect);
  }

  updateSelectedSessionHistoryItem(containerEl, callbacks.currentSessionId());
}

export function updateSelectedSessionHistoryItem(containerEl: HTMLElement, selectedSessionId: string): void {
  for (const itemEl of Array.from(containerEl.querySelectorAll(".opencode-session-history-item"))) {
    if (!(itemEl instanceof HTMLElement)) {
      continue;
    }

    itemEl.toggleClass("is-selected", itemEl.dataset.sessionId === selectedSessionId);
  }
}

function renderSessionHistoryItemContent(itemEl: HTMLElement, title: string, detail: string): void {
  const titleEl = itemEl.createDiv({ cls: "opencode-session-history-item-title" });
  if (itemEl.hasClass("opencode-session-history-item-new")) {
    const iconEl = titleEl.createSpan({ cls: "opencode-session-history-item-icon" });
    setIcon(iconEl, "plus");
    titleEl.createSpan({ cls: "opencode-session-history-item-title-text", text: title });
  } else {
    titleEl.createSpan({ cls: "opencode-session-history-item-title-text", text: title });
  }
  if (detail) {
    itemEl.createDiv({ cls: "opencode-session-history-item-detail", text: detail });
  }
}

function bindSessionHistoryItem(
  itemEl: HTMLElement,
  sessionId: string,
  onSelect: (sessionId: string) => void,
): void {
  itemEl.addEventListener("click", () => {
    onSelect(sessionId);
  });
  itemEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onSelect(sessionId);
  });
}

function addSessionActionButtons(
  itemEl: HTMLElement,
  session: OpenCodeSessionOption,
  callbacks: SessionHistoryCallbacks,
): void {
  const actionEl = itemEl.createDiv({ cls: "opencode-session-history-actions" });
  const renameButtonEl = actionEl.createEl("button", {
    cls: "opencode-session-history-action opencode-session-history-rename",
    attr: { type: "button", "aria-label": "セッション名を変更" },
  });
  setIcon(renameButtonEl, "pencil");
  renameButtonEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginRenameSession(itemEl, session, callbacks);
  });

  const deleteButtonEl = actionEl.createEl("button", {
    cls: "opencode-session-history-action opencode-session-history-delete",
    attr: { type: "button", "aria-label": "セッションを削除" },
  });
  setIcon(deleteButtonEl, "trash-2");
  deleteButtonEl.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onDelete(session);
  });
}

function beginRenameSession(
  itemEl: HTMLElement,
  session: OpenCodeSessionOption,
  callbacks: SessionHistoryCallbacks,
): void {
  const titleEl = itemEl.querySelector(".opencode-session-history-item-title");
  if (!(titleEl instanceof HTMLElement)) {
    return;
  }

  itemEl.addClass("is-editing");
  titleEl.empty();
  const inputEl = titleEl.createEl("input", {
    cls: "opencode-session-history-title-input",
    attr: { type: "text" },
    value: session.title,
  });
  inputEl.select();
  inputEl.focus();

  let canceled = false;
  let saving = false;
  const save = async (): Promise<void> => {
    if (saving || canceled) {
      return;
    }

    saving = true;
    const nextTitle = inputEl.value.trim();
    if (nextTitle && nextTitle !== session.title) {
      await callbacks.onRename(session.id, nextTitle);
      return;
    }

    callbacks.onCancelRename();
  };

  inputEl.addEventListener("click", (event) => event.stopPropagation());
  inputEl.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      canceled = true;
      callbacks.onCancelRename();
    }
  });
  inputEl.addEventListener("blur", () => {
    void save();
  });
}
