export type DocumentAction = "new" | "open" | "save" | "saveAs";

export function matchShortcut(
  e: Pick<KeyboardEvent, "metaKey" | "shiftKey" | "key">,
): DocumentAction | null {
  if (!e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (key === "s") return e.shiftKey ? "saveAs" : "save";
  if (key === "n") return "new";
  if (key === "o") return "open";
  return null;
}
