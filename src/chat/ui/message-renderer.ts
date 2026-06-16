import { Component, MarkdownRenderer, setIcon } from "obsidian";
import { ChatMessage, ChatMessageBlock, ChatMessageDetail } from "../shared/types";
import { normalizeMarkdownText } from "./view-utils";

export function renderMessageText(parentEl: HTMLElement, message: ChatMessage, owner: Component): void {
  if (message.role === "assistant") {
    renderAssistantText(parentEl, message.text, owner);
    return;
  }

  parentEl.createEl("pre", {
    cls: "opencode-chat-message-text",
    text: message.text,
  });
}

export function renderMessageBlocks(
  parentEl: HTMLElement,
  blocks: ChatMessageBlock[],
  openLastDetail: boolean,
  owner: Component,
): void {
  const lastDetailIndex = blocks.findLastIndex((block) => block.type === "detail");
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      renderAssistantText(parentEl, block.text, owner);
      return;
    }

    renderMessageDetail(parentEl, block.detail, openLastDetail && index === lastDetailIndex);
  });
}

export function renderMessageDetails(
  parentEl: HTMLElement,
  details: ChatMessageDetail[],
  openLastDetail: boolean,
): void {
  details.forEach((detail, index) => {
    renderMessageDetail(parentEl, detail, openLastDetail && index === details.length - 1);
  });
}

function renderAssistantText(parentEl: HTMLElement, text: string, owner: Component): void {
  const textEl = parentEl.createDiv({
    cls: "opencode-chat-message-text opencode-chat-message-markdown opencode-chat-final markdown-rendered",
  });
  void MarkdownRenderer.renderMarkdown(normalizeMarkdownText(text), textEl, "", owner).catch(() => {
    textEl.setText(text);
  });
}

function renderMessageDetail(parentEl: HTMLElement, detail: ChatMessageDetail, open: boolean): void {
  const detailEl = parentEl.createEl("details", {
    cls: `opencode-chat-detail opencode-chat-detail-${detail.kind}`,
  }) as HTMLDetailsElement;
  detailEl.open = open;
  detailEl.createEl("summary", {
    cls: "opencode-chat-detail-summary",
  });
  renderDetailSummary(detailEl, detail);
  if (detail.text) {
    const textWrapEl = detailEl.createDiv({ cls: "opencode-chat-detail-text-wrap" });
    textWrapEl.createEl("pre", {
      cls: "opencode-chat-detail-text",
      text: detail.text,
    });
  }
}

function renderDetailSummary(detailEl: HTMLElement, detail: ChatMessageDetail): void {
  const summaryEl = detailEl.querySelector(".opencode-chat-detail-summary");
  if (!(summaryEl instanceof HTMLElement)) {
    return;
  }

  const iconEl = summaryEl.createSpan({ cls: "opencode-chat-detail-icon" });
  setIcon(iconEl, detail.kind === "tool" ? "arrow-right" : "lightbulb");
  summaryEl.createSpan({
    cls: "opencode-chat-detail-title",
    text: detail.kind === "reasoning" ? "思考中" : detail.title,
  });
}
