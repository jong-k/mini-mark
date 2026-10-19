import { Editor, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { history } from "@milkdown/kit/plugin/history";
import { upload, uploadConfig } from "@milkdown/kit/plugin/upload";
import { codeBlockSchema, commonmark, imageSchema } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $ctx, $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { prism } from "@milkdown/plugin-prism";
import type { EditorHandle } from "./editor";
import { assetFileName, imageFilePath, relativeImageSrc } from "./lib/image-asset";
import { assetUrl, saveAsset, showError } from "./lib/tauri";

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

// basePath: 모델의 상대 경로 기준 폴더. 문서를 불러오거나 처음 저장할 때 정해지고 그 뒤로 고정된다.
// filePath: 현재 파일. 붙여넣은 이미지의 저장 위치이고 getValue가 상대 경로를 이 파일 기준으로 다시 쓴다.
// 다른 폴더로 저장해도 본문을 고치지 않으므로 undo 기록과 진행 중인 업로드가 가리키는 경로가 어긋나지 않는다.
interface DocumentPath {
  basePath: string | null;
  filePath: string | null;
}
const documentPath = $ctx<DocumentPath, "documentPath">({ basePath: null, filePath: null }, "documentPath");
const IMAGE_SRC_KEY = new PluginKey<DecorationSet>("imageSrc");
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

// 저장 위치가 basePath와 다른 폴더면 직렬화 시점에만 상대 경로를 다시 계산한다.
const imageWithRelocatedSrc = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const { basePath, filePath } = ctx.get(documentPath.key);
        const moved = basePath !== null && filePath !== null && dirOf(basePath) !== dirOf(filePath);
        const file = moved && !node.attrs.src.startsWith("/") ? imageFilePath(node.attrs.src, basePath) : null;
        state.addNode("image", undefined, undefined, {
          title: node.attrs.title,
          url: file === null ? node.attrs.src : relativeImageSrc(file, filePath!),
          alt: node.attrs.alt,
        });
      },
    },
  };
});

// 화면의 img src만 asset URL로 바꾼다. 모델과 클립보드 직렬화(toDOM)는 원문 경로를 유지한다.
// toDOM에서 바꾸면 replaceAll(view.updateState)이 node.eq가 참인 노드의 DOM을 재사용해 문서 전환 시 갱신되지 않는다.
// ponytail: 문서가 바뀔 때마다 이미지 노드를 전부 훑는다. 큰 문서에서 느리면 tr.mapping으로 옮기고 바뀐 범위만 다시 만든다.
const imageSrc = $prose((ctx) => {
  const build = (doc: Node) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== "image") return;
      const file = imageFilePath(node.attrs.src, ctx.get(documentPath.key).basePath);
      // 항상 src를 넣는다. 데코레이션이 사라지면 ProseMirror가 속성을 지워 img가 빈 src로 남는다.
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { src: file === null ? node.attrs.src : assetUrl(file) }),
      );
    });
    return DecorationSet.create(doc, decorations);
  };
  return new Plugin({
    key: IMAGE_SRC_KEY,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, set, _, state) => (tr.docChanged || tr.getMeta(IMAGE_SRC_KEY) ? build(state.doc) : set),
    },
    props: { decorations: (state) => IMAGE_SRC_KEY.getState(state) },
  });
});

// 실패해도 throw하지 않는다. upload 플러그인은 uploader가 reject하면 자리표시자를 지우지 않는다.
async function uploadImages(files: FileList, ctx: Ctx): Promise<Node[]> {
  const { basePath, filePath } = ctx.get(documentPath.key);
  if (filePath === null || basePath === null) {
    await showError("이미지를 넣으려면 먼저 문서를 저장하세요.");
    return [];
  }
  const image = ctx.get(schemaCtx).nodes.image!;
  const nodes: Node[] = [];
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      const rel = await saveAsset(dirOf(filePath), assetFileName(file.name, file.type, new Date()), data);
      // 모델 경로는 basePath 기준. 업로드 중 다른 폴더로 저장해도 파일은 시작 시점 폴더에 있다.
      const src = relativeImageSrc(`${dirOf(filePath)}/${rel}`, basePath);
      nodes.push(image.create({ src, alt: rel.slice("assets/".length).replace(/\.[^.]*$/, "") }));
    } catch (err) {
      await showError(String(err));
    }
  }
  return nodes;
}

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
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: (files, _schema, ctx) => uploadImages(files, ctx),
      }));
    })
    .use(commonmark)
    .use(codeBlockWithMeta)
    .use(imageWithRelocatedSrc)
    .use(gfm)
    .use(taskToggle)
    .use(history)
    .use(prism)
    .use(upload)
    .use(documentPath)
    .use(imageSrc)
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
      editor.action((ctx) => {
        // 불러온 본문의 상대 경로는 현재 파일 기준이다.
        ctx.update(documentPath.key, (d) => ({ ...d, basePath: d.filePath }));
        replaceAll(value.slice(raw.length), true)(ctx);
      });
    },
    setFilePath: (path) =>
      editor.action((ctx) => {
        // 새 문서(null)나 첫 저장이면 기준 폴더도 따라간다. 그 외에는 기준 폴더를 유지한다.
        ctx.update(documentPath.key, (d) => ({
          filePath: path,
          basePath: d.basePath === null || path === null ? path : d.basePath,
        }));
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setMeta(IMAGE_SRC_KEY, true));
      }),
  };
}
