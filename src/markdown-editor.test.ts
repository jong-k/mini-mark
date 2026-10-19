// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, expect, it, vi } from "vitest";
import { formatMarkdown } from "./lib/format-markdown";
import { createMarkdownEditor, editorHandle } from "./markdown-editor";

const wait = () => new Promise((r) => setTimeout(r, 300));
const onChange = vi.fn();
let destroy: () => Promise<unknown> = async () => {};

async function setup() {
  onChange.mockReset();
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor(root, onChange);
  destroy = () => editor.destroy();
  const type = (text: string) =>
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(text, 1));
    });
  return { handle: editorHandle(editor), type };
}

afterEach(() => destroy());

it("setValue does not fire onChange", async () => {
  const { handle } = await setup();
  handle.setValue("# hi\n");
  await wait();
  expect(onChange).not.toHaveBeenCalled();
});

it("typing fires onChange", async () => {
  const { handle, type } = await setup();
  handle.setValue("hi\n");
  type("a");
  await wait();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("ignores change pending before setValue", async () => {
  const { handle, type } = await setup();
  handle.setValue("hi\n");
  await wait();
  type("a");
  handle.setValue("# new\n");
  await wait();
  expect(onChange).not.toHaveBeenCalled();
});

const fixture = [
  "# 제목",
  "",
  "* 항목 *강조* **굵게**",
  "",
  "1. 하나",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "- [ ] 할 일",
  "",
  "~~취소~~ [링크](https://example.com)",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
].join("\n");

it("round-trips gfm and stabilizes after one pass", async () => {
  const { handle } = await setup();
  handle.setValue(fixture);
  const once = handle.getValue();
  expect(once).toContain("- 항목");
  expect(once).toContain("| a | b |");
  expect(once).toContain("- [ ] 할 일");
  expect(once).toContain("~~취소~~");
  expect(once).toContain("```ts");
  expect(once).not.toContain("\r");
  expect(once.endsWith("\n")).toBe(true);
  expect(once.endsWith("\n\n")).toBe(false);
  expect(formatMarkdown(once)).toBe(once);
  handle.setValue(once);
  expect(handle.getValue()).toBe(once);
});

it("setValue with empty string clears the document", async () => {
  const { handle } = await setup();
  handle.setValue("# hi\n");
  handle.setValue("");
  expect(handle.getValue()).toBe("");
});
