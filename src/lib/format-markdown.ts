export async function formatMarkdown(source: string): Promise<string> {
  try {
    const [{ format }, markdown] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/markdown"),
    ]);
    return await format(source, {
      parser: "markdown",
      plugins: [markdown],
      proseWrap: "preserve",
      endOfLine: "lf",
    });
  } catch {
    return source.replace(/\r\n?/g, "\n");
  }
}
