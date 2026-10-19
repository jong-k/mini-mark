import { Editor, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import type { EditorHandle } from "./editor";

export function createMarkdownEditor(root: HTMLElement, onChange: () => void): Promise<Editor> {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" as const }));
      ctx.get(listenerCtx).updated(() => onChange());
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .create();
}

export function editorHandle(editor: Editor): EditorHandle {
  return {
    getValue: () => editor.action(getMarkdown()),
    // flush=true: 교체가 히스토리에 쌓이거나 onChange를 발생시키지 않게 한다.
    setValue: (value) => editor.action(replaceAll(value, true)),
  };
}
