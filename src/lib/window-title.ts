export function windowTitle(filePath: string | null, isDirty: boolean): string {
  const name = filePath === null ? "Untitled" : (filePath.split("/").pop() ?? filePath);
  return isDirty ? `• ${name}` : name;
}
