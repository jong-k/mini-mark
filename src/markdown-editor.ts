import { Editor, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
import { history } from "@milkdown/kit/plugin/history";
import { codeBlockSchema, commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";
import type { EditorHandle } from "./editor";

// 기본 code_block은 언어만 보존한다. ```js title=a 같은 meta를 attr로 들고 다니며 왕복시킨다.
const codeBlockWithMeta = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, meta: { default: "" } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.openNode(type, { language: node.lang ?? "", meta: node.meta ?? "" });
        if (node.value) state.addText(node.value as string);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode("code", undefined, node.content.firstChild?.text || "", {
          lang: node.attrs.language,
          meta: node.attrs.meta || null,
        });
      },
    },
  };
});

export function toggleTaskItem(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "list_item" || node.attrs.checked == null) return false;
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }),
  );
  return true;
}

// 체크박스는 CSS ::before라 클릭 target이 li 자체다. 본문 텍스트 클릭은 target이 p나 text라 걸리지 않는다.
const taskToggle = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn: (view, _pos, _node, nodePos, event) =>
          event.target instanceof HTMLElement &&
          event.target.dataset.itemType === "task" &&
          toggleTaskItem(view, nodePos),
      },
    }),
);

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
    .use(codeBlockWithMeta)
    .use(gfm)
    .use(taskToggle)
    .use(history)
    .use(docChanged)
    .create();
}

export function editorHandle(editor: Editor): EditorHandle {
  // front matter는 에디터에서 편집하지 않고 보존만 한다. commonmark 파서가 구분선과 제목으로 망가뜨린다.
  let frontMatter = "";
  return {
    getValue: () => frontMatter + editor.action(getMarkdown()),
    // flush=true: 교체가 히스토리에 쌓이거나 onChange를 발생시키지 않게 한다.
    setValue: (value) => {
      const raw = value.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/)?.[0] ?? "";
      frontMatter = raw.replace(/\r\n/g, "\n");
      editor.action(replaceAll(value.slice(raw.length), true));
    },
  };
}
