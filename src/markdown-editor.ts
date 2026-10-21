import {
  Editor,
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { history } from "@milkdown/kit/plugin/history";
import { upload, uploadConfig } from "@milkdown/kit/plugin/upload";
import {
  codeBlockSchema,
  commonmark,
  headingKeymap,
  headingSchema,
  imageSchema,
  linkSchema,
  wrapInHeadingInputRule,
} from "@milkdown/kit/preset/commonmark";
import { extendListItemSchemaForTask, gfm } from "@milkdown/kit/preset/gfm";
import { textblockTypeInputRule } from "@milkdown/kit/prose/inputrules";
import { keymap } from "@milkdown/kit/prose/keymap";
import { type DOMOutputSpec, type Node, Slice } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $ctx, $inputRule, $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";

// 기본 규칙은 제목 안에서 `# `를 입력하면 기존 레벨에 더한다(h1에서 `# `면 h2). 마크다운처럼 입력한 # 개수를 레벨로 쓴다.
const headingInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^(#{1,6})\s$/, headingSchema.type(ctx), (match) => ({
    level: match[1]!.length,
  })),
);
import { prism } from "@milkdown/plugin-prism";
import type { EditorHandle, FindState } from "./editor";
import { findMatches, initialIndex, type Match, wrapIndex } from "./lib/find-matches";
import { assetFileName, localFilePath, relativeLocalSrc } from "./lib/image-asset";
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
const documentPath = $ctx<DocumentPath, "documentPath">(
  { basePath: null, filePath: null },
  "documentPath",
);
const IMAGE_SRC_KEY = new PluginKey<DecorationSet>("imageSrc");
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

// 저장 위치가 basePath와 다른 폴더면 직렬화 시점에만 로컬 상대 경로를 다시 계산한다.
function relocatedSrc(src: string, ctx: Ctx): string {
  const { basePath, filePath } = ctx.get(documentPath.key);
  if (
    basePath === null ||
    filePath === null ||
    dirOf(basePath) === dirOf(filePath) ||
    src.startsWith("/")
  )
    return src;
  const file = localFilePath(src, basePath);
  return file === null ? src : relativeLocalSrc(file, filePath);
}

const imageWithRelocatedSrc = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        state.addNode("image", undefined, undefined, {
          title: node.attrs.title,
          url: relocatedSrc(node.attrs.src, ctx),
          alt: node.attrs.alt,
        });
      },
    },
  };
});

// 로컬 상대 링크도 같은 기준으로 다시 쓴다. #앵커는 경로 부분만 바꾸고 그대로 붙인다.
const linkWithRelocatedHref = linkSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, mark) => {
        const href: string = mark.attrs.href;
        const hashAt = href.indexOf("#");
        const path = hashAt < 0 ? href : href.slice(0, hashAt);
        const hash = hashAt < 0 ? "" : href.slice(hashAt);
        state.withMark(mark, "link", undefined, {
          title: mark.attrs.title,
          url: (path === "" ? "" : relocatedSrc(path, ctx)) + hash,
        });
      },
    },
  };
});

// 화면의 img src만 asset URL로 바꾼다. 모델과 클립보드 직렬화(toDOM)는 원문 경로를 유지한다.
// toDOM에서 바꾸면 replaceAll(view.updateState)이 node.eq가 참인 노드의 DOM을 재사용해 문서 전환 시 갱신되지 않는다.
const imageSrc = $prose((ctx) => {
  const decorationsIn = (doc: Node, from: number, to: number) => {
    const decorations: Decoration[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== "image") return;
      const file = localFilePath(node.attrs.src, ctx.get(documentPath.key).basePath);
      // 항상 src를 넣는다. 데코레이션이 사라지면 ProseMirror가 속성을 지워 img가 빈 src로 남는다.
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          src: file === null ? node.attrs.src : assetUrl(file),
        }),
      );
    });
    return decorations;
  };
  const build = (doc: Node) => DecorationSet.create(doc, decorationsIn(doc, 0, doc.content.size));
  return new Plugin({
    key: IMAGE_SRC_KEY,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, set, _, state) => {
        if (tr.getMeta(IMAGE_SRC_KEY)) return build(state.doc);
        if (!tr.docChanged) return set;
        // 기존 데코레이션은 위치만 옮기고 바뀐 범위만 다시 만든다. 교체된 이미지 노드는 매핑 뒤에도 옛 src가 남으므로 범위 안은 지운다.
        let next = set.map(tr.mapping, tr.doc);
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1);
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const from = rest.map(newStart, -1);
            const to = rest.map(newEnd, 1);
            const stale = next.find(from, to).filter((d) => d.from < to && d.to > from);
            next = next.remove(stale).add(tr.doc, decorationsIn(tr.doc, from, to));
          });
        });
        return next;
      },
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
      const data = new Uint8Array(await file.arrayBuffer());
      const rel = await saveAsset(
        dirOf(filePath),
        assetFileName(file.name, file.type, new Date()),
        data,
      );
      // 모델 경로는 basePath 기준. 업로드 중 다른 폴더로 저장해도 파일은 시작 시점 폴더에 있다.
      const src = relativeLocalSrc(`${dirOf(filePath)}/${rel}`, basePath);
      nodes.push(image.create({ src, alt: rel.slice("assets/".length).replace(/\.[^.]*$/, "") }));
    } catch (err) {
      await showError(String(err));
    }
  }
  return nodes;
}

// 찾기. 검색어는 플러그인 상태가 아니라 ctx에 둔다. setValue의 replaceAll이 EditorState를 새로 만들어 플러그인 init이 다시 돌기 때문이다.
const findRequest = $ctx<{ query: string }, "findRequest">({ query: "" }, "findRequest");
const findListeners = $ctx<Set<(state: FindState) => void>, "findListeners">(
  new Set(),
  "findListeners",
);
const FIND_KEY = new PluginKey<FindPluginState>("find");

interface FindPluginState {
  query: string;
  matches: Match[];
  current: number;
  decorations: DecorationSet;
  /** 검색과 이동 직후에만 참. 편집으로 다시 찾을 때는 스크롤하지 않는다. */
  scroll: boolean;
}

type FindMeta =
  | { type: "search"; query: string }
  | { type: "step"; delta: 1 | -1 }
  | { type: "close" };

function decorate(doc: Node, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? "find-match find-match-current" : "find-match",
      }),
    ),
  );
}

function buildFind(query: string, doc: Node, pos: number, scroll: boolean): FindPluginState {
  const matches = findMatches(doc, query);
  const current = initialIndex(matches, pos);
  return { query, matches, current, decorations: decorate(doc, matches, current), scroll };
}

const toFindState = (s: FindPluginState): FindState => ({
  query: s.query,
  count: s.matches.length,
  current: s.current,
});

const findPlugin = $prose((ctx) => {
  const notify = (s: FindPluginState) => {
    for (const listener of ctx.get(findListeners.key)) listener(toFindState(s));
  };
  return new Plugin({
    key: FIND_KEY,
    state: {
      init: (_, state) =>
        buildFind(ctx.get(findRequest.key).query, state.doc, state.selection.from, false),
      apply: (tr, prev, _, state) => {
        const meta = tr.getMeta(FIND_KEY) as FindMeta | undefined;
        if (meta?.type === "search")
          return buildFind(meta.query, state.doc, state.selection.from, true);
        if (meta?.type === "step") {
          const current = wrapIndex(prev.matches.length, prev.current, meta.delta);
          return {
            ...prev,
            current,
            decorations: decorate(state.doc, prev.matches, current),
            scroll: true,
          };
        }
        if (meta?.type === "close") return buildFind("", state.doc, 0, false);
        if (!tr.docChanged) return prev;
        // 편집 전 현재 일치의 위치 이후 첫 일치를 현재로 삼는다.
        const pos = prev.current >= 0 ? tr.mapping.map(prev.matches[prev.current]!.from) : 0;
        return buildFind(prev.query, state.doc, pos, false);
      },
    },
    props: { decorations: (state) => FIND_KEY.getState(state)!.decorations },
    view: (view) => {
      // setValue의 replaceAll은 플러그인 배열이 다른 상태를 만들어 ProseMirror가 플러그인 view를 다시 만든다. 그때 update는 불리지 않으므로 여기서 알린다.
      notify(FIND_KEY.getState(view.state)!);
      return {
        update: (view, prevState) => {
          const s = FIND_KEY.getState(view.state)!;
          const p = FIND_KEY.getState(prevState)!;
          if (s === p) return;
          // jsdom에는 scrollIntoView가 없다.
          if (s.scroll && s.current >= 0)
            view.dom.querySelector(".find-match-current")?.scrollIntoView?.({ block: "center" });
          if (
            s.query !== p.query ||
            s.matches.length !== p.matches.length ||
            s.current !== p.current
          )
            notify(s);
        },
      };
    },
  });
});

export function toggleTaskItem(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "list_item" || node.attrs.checked == null) return false;
  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }),
  );
  return true;
}

// 체크박스는 CSS ::before라 DOM 요소가 없다. 보조 기술이 작업 항목을 체크박스로 읽도록 li에 role과 상태를 붙인다.
// extendSchema는 호출한 객체의 원본을 확장하므로 commonmark의 listItemSchema가 아니라 gfm이 task를 더한 스키마를 기준으로 삼는다.
const taskItemAccessible = extendListItemSchemaForTask.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toDOM: (node) => {
      const [tag, attrs, ...rest] = base.toDOM!(node) as [
        string,
        Record<string, unknown>,
        ...unknown[],
      ];
      const task =
        node.attrs.checked == null
          ? {}
          : { role: "checkbox", "aria-checked": String(node.attrs.checked) };
      return [tag, { ...attrs, ...task }, ...rest] as DOMOutputSpec;
    },
  };
});

// 키보드로도 토글한다. 커서가 있는 가장 안쪽 list_item이 대상이다.
const taskToggleKey = $prose(() =>
  keymap({
    "Mod-Enter": (state, _dispatch, view) => {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === "list_item")
          return view !== undefined && toggleTaskItem(view, $from.before(depth));
      }
      return false;
    },
  }),
);

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

function clipboardMarkdown(slice: Slice, ctx: Ctx): string {
  const schema = ctx.get(schemaCtx);
  const serialize = (doc: Node) => ctx.get(serializerCtx)(doc).replace(/\n+$/, "");
  let content = slice.content;
  while (content.childCount === 1 && !content.firstChild!.isTextblock)
    content = content.firstChild!.content;
  const block = content.childCount === 1 ? content.firstChild! : null;
  // 한 블록 안의 선택은 인라인 서식만 남긴다. 제목 일부를 복사할 때 "#"이 붙지 않게 한다.
  if (block?.isTextblock) {
    if (block.type.spec.code) return block.textContent;
    return serialize(
      schema.topNodeType.create(null, schema.nodes.paragraph!.create(null, block.content)),
    );
  }
  const doc = schema.topNodeType.createAndFill(null, slice.content);
  // 빈 문자열이면 ProseMirror가 기본 텍스트 추출로 처리한다.
  return doc ? serialize(doc) : "";
}

// ponytail: VS Code 판별은 경험칙이다. WKWebView가 vscode-editor-data를 노출하지 않을 수 있어 VS Code HTML의 white-space: pre 스타일도 본다. 다른 편집기가 잘못 판별되면 여기에 추가한다.
const fromCodeEditor = (data: DataTransfer, html: string) =>
  data.types.includes("vscode-editor-data") || /white-space:\s*pre[;"]/.test(html);

// 복사할 때 text/plain을 마크다운으로 채운다. text/html은 기본값 그대로 두어 서식을 받는 앱과 에디터 안 붙여넣기는 서식을 유지한다.
// 붙여넣을 때는 서식 HTML이 없는 마크다운 텍스트를 파싱해 서식으로 보여 준다. 스펙과 결정 이유는 docs/spec/clipboard.md.
const markdownClipboard = $prose(
  (ctx) =>
    new Plugin({
      props: {
        clipboardTextSerializer: (slice) => clipboardMarkdown(slice, ctx),
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          if (!data || view.state.selection.$from.parent.type.spec.code) return false;
          const text = data.getData("text/plain");
          const html = data.getData("text/html");
          if (text === "" || (html !== "" && !fromCodeEditor(data, html))) return false;
          const doc = ctx.get(parserCtx)(text);
          view.dispatch(
            view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView(),
          );
          return true;
        },
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
      // 기본값은 제목 맨 앞 Backspace가 레벨을 하나씩 낮춘다(h4면 4번 눌러야 앞 줄로 간다). 끄면 ProseMirror 기본 동작으로 바로 앞 줄과 합쳐진다.
      ctx.update(headingKeymap.key, (k) => ({ ...k, DowngradeHeading: { shortcuts: [] } }));
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: (files, _schema, ctx) => uploadImages(files, ctx),
      }));
      // $ctx 기본값 Set은 에디터 인스턴스 사이에 공유된다. 인스턴스마다 새로 만든다.
      ctx.set(findListeners.key, new Set());
    })
    .use(commonmark.filter((plugin) => plugin !== wrapInHeadingInputRule))
    .use(headingInputRule)
    .use(codeBlockWithMeta)
    .use(imageWithRelocatedSrc)
    .use(linkWithRelocatedHref)
    .use(gfm)
    .use(taskItemAccessible)
    .use(taskToggle)
    .use(taskToggleKey)
    .use(history)
    .use(prism)
    .use(upload)
    .use(markdownClipboard)
    .use(documentPath)
    .use(imageSrc)
    .use(docChanged)
    .use(findRequest)
    .use(findListeners)
    .use(findPlugin)
    .create();
}

export function editorHandle(editor: Editor): EditorHandle {
  // front matter는 에디터에서 편집하지 않고 보존만 한다. commonmark 파서가 구분선과 제목으로 망가뜨린다.
  let frontMatter = "";
  return {
    getValue: () => {
      const body = editor.action(getMarkdown());
      // 닫는 --- 뒤에 개행 없이 끝난 front matter에 본문이 생기면 구분자와 본문이 붙는다.
      const gap = body !== "" && frontMatter !== "" && !frontMatter.endsWith("\n") ? "\n" : "";
      return frontMatter + gap + body;
    },
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
    find: {
      search: (query) =>
        editor.action((ctx) => {
          ctx.set(findRequest.key, { query });
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(FIND_KEY, { type: "search", query }));
        }),
      step: (delta) =>
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          view.dispatch(view.state.tr.setMeta(FIND_KEY, { type: "step", delta }));
        }),
      close: () =>
        editor.action((ctx) => {
          ctx.set(findRequest.key, { query: "" });
          const view = ctx.get(editorViewCtx);
          const s = FIND_KEY.getState(view.state)!;
          const match = s.matches[s.current];
          let tr = view.state.tr.setMeta(FIND_KEY, { type: "close" });
          if (match)
            tr = tr
              .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
              .scrollIntoView();
          view.dispatch(tr);
          view.focus();
        }),
      selectionText: () =>
        editor.action((ctx) => {
          const { doc, selection } = ctx.get(editorViewCtx).state;
          const text = doc.textBetween(selection.from, selection.to, "\n");
          return text.includes("\n") ? "" : text;
        }),
      onChange: (listener) =>
        editor.action((ctx) => {
          const listeners = ctx.get(findListeners.key);
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }),
    },
  };
}
