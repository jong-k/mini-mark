export function formatMarkdown(source: string): string {
  const lf = source.replace(/\r\n?/g, "\n");
  if (lf === "") return "";
  return lf.replace(/\n*$/, "\n");
}
