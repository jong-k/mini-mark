import { Editor, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Plugin } from "@milkdown/kit/prose/state";
import { $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";
import type { EditorHandle } from "./editor";

export function createMarkdownEditor(root: HTMLElement, onChange: () => void): Promise<Editor> {
  // 동기 더티 신호. listener 플러그인은 200ms 디바운스라 그 안에 창을 닫으면 변경이 유실된다.
  const docChanged = $prose(
    () =>
      new Plugin({
        view: () => ({
          update: (view, prevState) => {
            if (view.state.doc !== prevState.doc) onChange();
          },
        }),
      }),
  );

  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" as const }));
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(docChanged)
    .create();
}

export function editorHandle(editor: Editor): EditorHandle {
  return {
    getValue: () => editor.action(getMarkdown()),
    // flush=true: 교체가 히스토리에 쌓이거나 onChange를 발생시키지 않게 한다.
    setValue: (value) => editor.action(replaceAll(value, true)),
  };
}
