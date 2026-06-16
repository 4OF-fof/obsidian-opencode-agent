import { PickerOption } from "./view-types";

export function sortSelectedFirst(options: PickerOption[], selectedValue: string): PickerOption[] {
  if (!selectedValue) {
    return options;
  }

  return [...options].sort((a, b) => {
    if (a.value === selectedValue) {
      return -1;
    }
    if (b.value === selectedValue) {
      return 1;
    }
    return 0;
  });
}

export function maxInputHeight(inputEl: HTMLTextAreaElement): number {
  const style = window.getComputedStyle(inputEl);
  const minHeight = parseFloat(style.minHeight) || inputEl.clientHeight || 56;
  return minHeight * 3;
}

export function formatSessionTime(value: number): string {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString();
}

export function normalizeMarkdownText(text: string): string {
  const lines = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n");
  const normalizedLines: string[] = [];
  let inFence = false;
  let previousBlank = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      normalizedLines.push(line);
      previousBlank = false;
      continue;
    }

    if (!inFence && line.trim() === "") {
      if (!previousBlank) {
        normalizedLines.push(line);
      }
      previousBlank = true;
      continue;
    }

    normalizedLines.push(line);
    previousBlank = false;
  }

  return normalizedLines.join("\n");
}
