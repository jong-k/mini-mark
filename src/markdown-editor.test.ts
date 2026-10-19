// @vitest-environment jsdom
import { editorViewCtx, schemaCtx, type Editor } from "@milkdown/kit/core";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import type { Node } from "@milkdown/kit/prose/model";
import { undo } from "@milkdown/kit/prose/history";
import { afterEach, expect, it, vi } from "vitest";
import { formatMarkdown } from "./lib/format-markdown";
import { saveAsset, showError } from "./lib/tauri";
import { createMarkdownEditor, editorHandle, toggleTaskItem } from "./markdown-editor";

vi.mock("./lib/tauri", () => ({
  assetUrl: (path: string) => `asset://localhost${path}`,
  saveAsset: vi.fn(async (_dir: string, fileName: string) => `assets/${fileName}`),
  showError: vi.fn(async () => {}),
}));

const onChange = vi.fn();
let destroy: () => Promise<unknown> = async () => {};
let root: HTMLElement | null = null;

async function setup() {
  onChange.mockReset();
  root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await createMarkdownEditor(root, onChange);
  destroy = () => editor.destroy();
  const type = (text: string) =>
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText(text, 1));
    });
  const runUndo = () =>
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      undo(view.state, view.dispatch);
    });
  return { handle: editorHandle(editor), type, runUndo, editor };
}

afterEach(async () => {
  vi.mocked(saveAsset).mockClear();
  vi.mocked(showError).mockClear();
  const d = destroy;
  destroy = async () => {};
  await d();
  root?.remove();
  root = null;
});

it("setValue does not fire onChange", async () => {
  const { handle } = await setup();
  handle.setValue("# hi\n");
  expect(onChange).not.toHaveBeenCalled();
});

it("typing fires onChange", async () => {
  const { handle, type } = await setup();
  handle.setValue("hi\n");
  type("a");
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("undo after setValue does not restore previous document", async () => {
  const { handle, runUndo } = await setup();
  handle.setValue("# old\n");
  handle.setValue("# new\n");
  runUndo();
  expect(handle.getValue()).toBe("# new\n");
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

it("preserves leading front matter across setValue and getValue", async () => {
  const { handle } = await setup();
  const doc = "---\ntitle: x\n---\n\n# 본문\n";
  handle.setValue(doc);
  expect(handle.getValue()).toBe(doc);
  expect(handle.getValue()).not.toContain("***");
  handle.setValue("plain\n");
  expect(handle.getValue()).toBe("plain\n");
});

it.each([
  ["닫는 --- 뒤 EOF", "---\ntitle: x\n---"],
  ["BOM 시작", "﻿---\ntitle: x\n---\n\n# 본문\n"],
])("preserves front matter: %s", async (_name, doc) => {
  const { handle } = await setup();
  handle.setValue(doc);
  expect(handle.getValue()).toBe(doc);
});

it("normalizes CRLF front matter to LF like the body", async () => {
  const { handle } = await setup();
  handle.setValue("---\r\ntitle: x\r\n---\r\n\r\n# 본문\r\n");
  expect(handle.getValue()).toBe("---\ntitle: x\n---\n\n# 본문\n");
});

it("preserves code fence meta", async () => {
  const { handle } = await setup();
  const doc = "```js title=example {1,3}\nconst a = 1;\n```\n";
  handle.setValue(doc);
  expect(handle.getValue()).toBe(doc);
});

it("toggles task item checked state", async () => {
  const { handle, editor } = await setup();
  handle.setValue("- [ ] a\n");
  // doc(0) > bullet_list(0) > list_item(1)
  editor.action((ctx) => toggleTaskItem(ctx.get(editorViewCtx), 1));
  expect(handle.getValue()).toBe("- [x] a\n");
  expect(onChange).toHaveBeenCalledTimes(1);
  editor.action((ctx) => toggleTaskItem(ctx.get(editorViewCtx), 1));
  expect(handle.getValue()).toBe("- [ ] a\n");
});

it("ignores toggle on a plain list item", async () => {
  const { handle, editor } = await setup();
  handle.setValue("- a\n");
  const toggled = editor.action((ctx) => toggleTaskItem(ctx.get(editorViewCtx), 1));
  expect(toggled).toBe(false);
  expect(handle.getValue()).toBe("- a\n");
  expect(onChange).not.toHaveBeenCalled();
});

it("highlights code block tokens", async () => {
  const { handle } = await setup();
  handle.setValue("```ts\nconst x = 1;\n```\n");
  expect(root!.querySelector("pre .token.keyword")?.textContent).toBe("const");
  expect(handle.getValue()).toBe("```ts\nconst x = 1;\n```\n");
});

it("leaves unknown language code block without tokens", async () => {
  const { handle, type } = await setup();
  handle.setValue("```text\nconst x = 1;\n```\n");
  expect(root!.querySelector("pre .token")).toBeNull();
  type("a");
  expect(handle.getValue()).toBe("```text\naconst x = 1;\n```\n");
});

const imageSrc = () => root!.querySelector("img:not(.ProseMirror-separator)")?.getAttribute("src");

it("renders relative image src against the document path", async () => {
  const { handle } = await setup();
  handle.setFilePath("/docs/n.md");
  handle.setValue("![pic](assets/p.png)\n");
  expect(imageSrc()).toBe("asset://localhost/docs/assets/p.png");
  expect(handle.getValue()).toBe("![pic](assets/p.png)\n");
  expect(onChange).not.toHaveBeenCalled();
});

it("leaves remote image src untouched", async () => {
  const { handle } = await setup();
  handle.setFilePath("/docs/n.md");
  handle.setValue("![pic](https://example.com/p.png)\n");
  expect(imageSrc()).toBe("https://example.com/p.png");
});

it("re-resolves image src when another document with the same relative path opens", async () => {
  const { handle } = await setup();
  handle.setFilePath("/a/n.md");
  handle.setValue("![pic](assets/p.png)\n");
  handle.setFilePath("/b/n.md");
  handle.setValue("![pic](assets/p.png)\n");
  expect(imageSrc()).toBe("asset://localhost/b/assets/p.png");
  expect(handle.getValue()).toBe("![pic](assets/p.png)\n");
});

it("rewrites relative image src when the document moves to another folder", async () => {
  const { handle } = await setup();
  handle.setFilePath("/a/n.md");
  handle.setValue("![pic](assets/p.png) ![abs](/x/q.png) ![web](https://example.com/r.png)\n");
  handle.setFilePath("/b/n.md");
  expect(handle.getValue()).toBe("![pic](../a/assets/p.png) ![abs](/x/q.png) ![web](https://example.com/r.png)\n");
  expect(imageSrc()).toBe("asset://localhost/a/assets/p.png");
  expect(onChange).not.toHaveBeenCalled();
  handle.setFilePath("/a/n.md");
  expect(handle.getValue()).toBe("![pic](assets/p.png) ![abs](/x/q.png) ![web](https://example.com/r.png)\n");
});

it("undo after moving the document restores image paths against the original folder", async () => {
  const { handle, editor, runUndo } = await setup();
  handle.setFilePath("/a/n.md");
  handle.setValue("![pic](assets/p.png)\n");
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.delete(1, 2)); // 이미지 삭제
  });
  expect(handle.getValue()).toBe("");
  handle.setFilePath("/b/n.md");
  runUndo();
  expect(imageSrc()).toBe("asset://localhost/a/assets/p.png");
  expect(handle.getValue()).toBe("![pic](../a/assets/p.png)\n");
});

it("upload started before moving the document keeps pointing at the saved file", async () => {
  const { handle, editor } = await setup();
  handle.setFilePath("/a/n.md");
  handle.setValue("x\n");
  let finish: (rel: string) => void = () => {};
  vi.mocked(saveAsset).mockImplementationOnce(() => new Promise((r) => (finish = r)));
  const file = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
  const pending = runUploader(editor, [file]);
  await vi.waitFor(() => expect(saveAsset).toHaveBeenCalled());
  handle.setFilePath("/b/n.md");
  finish("assets/image-1.png");
  const nodes = (await pending) as Node[];
  expect(saveAsset).toHaveBeenCalledWith("/a", expect.any(String), [1]);
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insert(1, nodes[0]!));
  });
  expect(imageSrc()).toBe("asset://localhost/a/assets/image-1.png");
  expect(handle.getValue()).toBe("![image-1](../a/assets/image-1.png)x\n");
});

it("does not rewrite image src on the first save of an untitled document", async () => {
  const { handle } = await setup();
  handle.setFilePath(null);
  handle.setValue("![pic](assets/p.png)\n");
  handle.setFilePath("/a/n.md");
  expect(handle.getValue()).toBe("![pic](assets/p.png)\n");
  expect(imageSrc()).toBe("asset://localhost/a/assets/p.png");
  expect(onChange).not.toHaveBeenCalled();
});

function runUploader(editor: Editor, files: File[]) {
  return editor.action((ctx) =>
    ctx.get(uploadConfig.key).uploader(files as unknown as FileList, ctx.get(schemaCtx), ctx, 0),
  );
}

it("pasting an image without a file path shows an error and inserts nothing", async () => {
  const { handle, editor } = await setup();
  handle.setFilePath(null);
  const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  expect(await runUploader(editor, [file])).toEqual([]);
  expect(showError).toHaveBeenCalledTimes(1);
  expect(saveAsset).not.toHaveBeenCalled();
});

it("pasting an image saves it under assets and returns a relative image node", async () => {
  const { handle, editor } = await setup();
  handle.setFilePath("/docs/n.md");
  const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  const nodes = await runUploader(editor, [file]);
  expect(saveAsset).toHaveBeenCalledWith("/docs", expect.stringMatching(/^image-\d{8}-\d{6}\.png$/), [1, 2, 3]);
  expect(nodes).toHaveLength(1);
  expect((nodes as Node[])[0]!.attrs.src).toMatch(/^assets\/image-\d{8}-\d{6}\.png$/);
});
