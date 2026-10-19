# 3단계: Typora 스타일 UI 및 확장 렌더링 고도화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단계 Milkdown 에디터 위에 본문 타이포그래피와 다크 모드, 작업 목록 체크박스 토글, 코드 블록 구문 강조, 로컬 이미지 렌더링과 붙여넣기 저장을 얹는다.

**Architecture:** 스타일은 `src/app.css` 하나에 CSS 변수와 `prefers-color-scheme`로 둔다(Tailwind 미도입). 에디터 확장은 모두 `src/markdown-editor.ts`의 Milkdown 플러그인으로 들어가고, `EditorHandle`에는 `setFilePath(path)` 하나만 추가한다. 이미지 상대 경로는 문서 경로를 담은 Milkdown ctx 슬라이스(`documentPath`)를 읽어 ProseMirror 노드 데코레이션으로 `img`의 `src`만 Tauri asset URL로 바꾸고, 모델과 저장 마크다운에는 상대 경로를 그대로 유지한다. 문서가 다른 폴더로 저장되면 상대 경로를 새 폴더 기준으로 다시 써서 원래 이미지 파일을 계속 가리키게 한다. 붙여넣기와 드롭은 `@milkdown/kit/plugin/upload`의 `uploader`를 바꿔 Rust `save_asset` 커맨드로 `<문서 폴더>/assets/`에 기록한다. 순수 경로 계산은 `src/lib/image-asset.ts`에 두고 Vitest로 검증한다.

**Tech Stack:** Tauri v2 (asset protocol, `convertFileSrc`), React 19, TypeScript, Vite 8, Vitest 5 + jsdom, `@milkdown/kit` 7.22 (`preset/commonmark`, `preset/gfm`, `plugin/upload`, `utils`), `@milkdown/plugin-prism` 7.22 (refractor 포함)

**Spec:** `docs/PLAN.md` 3단계 절

## Global Constraints

- 새 runtime 의존성은 `@milkdown/plugin-prism` 하나다. Tailwind CSS, `@tailwindcss/typography`, Shiki, `@tauri-apps/plugin-fs`, `@milkdown/kit/component`(Lit 기반 코드 블록과 이미지 컴포넌트)는 쓰지 않는다. `docs/PLAN.md` 기술 스택 표의 스타일링 행은 Task 6에서 "순수 CSS"로 고친다.
- `EditorHandle`은 `setFilePath(path: string | null): void`만 추가한다. `getValue`, `setValue` 시그니처는 그대로다. `setFilePath`는 문서 폴더가 바뀌어 이미지 경로를 다시 쓸 때만 `onChange`를 발생시킨다.
- `getValue()` 출력에 `asset://`, `http://asset.localhost` 같은 해석된 URL이 들어가면 안 된다. 모델의 `image.attrs.src`는 항상 마크다운에 적힌 원문 경로다.
- 이미지 렌더링은 `toDOM` 대신 노드 데코레이션으로 `src`를 바꾼다. `replaceAll`은 `view.updateState`를 쓰고 ProseMirror가 같은 노드의 DOM을 재사용하므로 `toDOM`은 문서 전환 시 다시 실행되지 않는다.
- 이미지 바이트는 `number[]`(JSON 배열)로 `invoke`한다. `ponytail:` 주석으로 한계(큰 파일이 느리면 `tauri::ipc::Request` raw body로 교체)를 남긴다.
- `src-tauri/tauri.conf.json`: `app.security.assetProtocol`을 `{ "enable": true, "scope": ["$HOME/**"] }`로, 메인 창에 `"dragDropEnabled": false`를 둔다. `csp`는 1단계부터 `null`이며 이 계획에서도 바꾸지 않는다.
- 에디터 안 모든 텍스트 입력은 한글 IME에서 자소 분리가 없어야 한다. 구문 강조 데코레이션과 체크박스 토글은 ProseMirror 트랜잭션만 쓰고 DOM을 직접 만지지 않는다.
- jsdom 테스트에서 `src/lib/tauri.ts`는 `vi.mock`으로 대체한다(`convertFileSrc`는 `window.__TAURI_INTERNALS__`가 필요하다).
- 파일과 식별자 이름은 `docs/conventions/naming-convention.md`, 커밋 메시지는 `docs/conventions/commit-convention.md`를 따른다. 모든 텍스트에 가운뎃점 문자를 쓰지 않는다.

## Review Focus

- 저장하지 않은 문서(`filePath === null`)에 이미지 붙여넣기: 안내 메시지가 뜨고 "Upload in progress..." 자리표시자가 남지 않아야 한다. Task 5 테스트 `pasting an image without a file path shows an error and inserts nothing`.
- 같은 상대 경로 이미지(`![pic](assets/p.png)`)를 가진 두 문서를 차례로 열기: 두 번째 문서의 폴더 기준으로 이미지가 바뀌어야 한다. ProseMirror는 `node.eq`가 참인 노드의 DOM을 재사용하므로 `toDOM`만으로는 갱신되지 않는다. Task 5 테스트 `re-resolves image src when another document with the same relative path opens`.
- 다른 폴더로 "다른 이름으로 저장": 상대 경로 이미지가 원래 파일을 계속 가리키도록 `../` 경로로 다시 써지고, 다시 열어도 보여야 한다. 절대 경로와 원격 URL은 그대로다. Task 5 테스트 `rewrites relative image src when the document moves to another folder`.
- 파일명의 `%`, `#`, 공백: 마크다운 URL `chart%231.png`는 `chart#1.png` 파일에, 인코딩되지 않은 `100%.png`는 그대로 연결되어야 한다. 붙여넣거나 드롭한 파일명은 저장 시 안전한 문자로 바꾼다. Task 5 테스트 `image-asset.test.ts`.
- 같은 이름의 이미지를 두 번 저장: 두 번째는 `-1` 접미사를 받고 첫 파일을 덮어쓰지 않아야 한다. Task 4 테스트 `save_asset_adds_suffix_on_collision`.
- 언어가 없거나 Prism이 모르는 언어의 코드 블록(```` ``` ````, ```` ```text ````): 강조 없이 정상 편집되고 예외가 없어야 한다. Task 3 테스트 `leaves unknown language code block without tokens`.

---

### Task 1: 본문 타이포그래피와 다크 모드 스타일

**Files:**
- Modify: `src/app.css` (전체 교체)

**Interfaces:**
- Consumes: Milkdown이 렌더하는 DOM 속성. 작업 목록 `li[data-item-type="task"][data-checked]`, 각주 `sup[data-type="footnote_reference"]`, `dl[data-type="footnote_definition"]`, 코드 블록 `pre[data-language] > code`.
- Produces: CSS 변수 `--bg`, `--fg`, `--muted`, `--border`, `--code-bg`, `--accent`. Task 3의 토큰 색상이 `--muted`를 쓴다.

- [ ] **Step 1: `src/app.css` 교체**

```css
@import "@milkdown/kit/prose/view/style/prosemirror.css";
@import "@milkdown/kit/prose/tables/style/tables.css";

:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #6e7781;
  --border: #d0d7de;
  --code-bg: #f6f8fa;
  --accent: #0969da;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e1e;
    --fg: #d4d4d4;
    --muted: #8b949e;
    --border: #3b3b3b;
    --code-bg: #2a2a2a;
    --accent: #58a6ff;
  }
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}

.ProseMirror {
  min-height: 100vh;
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 32px;
  box-sizing: border-box;
  outline: none;
  font: 16px/1.7 -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif;
}

.ProseMirror h1 { font-size: 2em; margin: 1em 0 0.5em; line-height: 1.3; }
.ProseMirror h2 { font-size: 1.5em; margin: 1em 0 0.5em; line-height: 1.3; }
.ProseMirror h3 { font-size: 1.25em; margin: 1em 0 0.5em; }
.ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { font-size: 1em; margin: 1em 0 0.5em; }
.ProseMirror p { margin: 0 0 1em; }
.ProseMirror a { color: var(--accent); }
.ProseMirror blockquote { margin: 0 0 1em; padding: 0 1em; border-left: 4px solid var(--border); color: var(--muted); }
.ProseMirror hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }

.ProseMirror code { font: 0.9em/1.5 ui-monospace, Menlo, monospace; background: var(--code-bg); padding: 0.15em 0.35em; border-radius: 4px; }
.ProseMirror pre { background: var(--code-bg); padding: 12px 16px; border-radius: 6px; overflow-x: auto; margin: 0 0 1em; }
.ProseMirror pre code { background: none; padding: 0; }

.ProseMirror ul, .ProseMirror ol { padding-left: 1.6em; margin: 0 0 1em; }
.ProseMirror li > p { margin: 0; }
.ProseMirror li > ul, .ProseMirror li > ol { margin: 0; }

.ProseMirror table { border-collapse: collapse; margin: 0 0 1em; }
.ProseMirror th, .ProseMirror td { border: 1px solid var(--border); padding: 6px 12px; }
.ProseMirror th { background: var(--code-bg); }

.ProseMirror img { max-width: 100%; }
.ProseMirror img.ProseMirror-selectednode { outline: 2px solid var(--accent); }

/* 작업 목록. 체크박스는 Task 2의 클릭 플러그인이 li 자체를 클릭 대상으로 삼으므로 ::before로만 그린다. */
.ProseMirror li[data-item-type="task"] { list-style: none; position: relative; }
.ProseMirror li[data-item-type="task"]::before { content: "☐"; position: absolute; left: -1.6em; top: 0; cursor: pointer; user-select: none; }
.ProseMirror li[data-item-type="task"][data-checked="true"]::before { content: "☑"; }
.ProseMirror li[data-item-type="task"][data-checked="true"] > p { color: var(--muted); text-decoration: line-through; }

.ProseMirror sup[data-type="footnote_reference"] { color: var(--accent); }
.ProseMirror dl[data-type="footnote_definition"] { margin: 1em 0; padding-top: 0.5em; border-top: 1px solid var(--border); font-size: 0.9em; color: var(--muted); }
```

- [ ] **Step 2: 타입 체크와 빌드**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: 에러 없음. `dist/assets/*.css`에 `prefers-color-scheme`가 들어 있다.

- [ ] **Step 3: 수동 확인**

Run: `pnpm tauri dev`

1. `# 제목`, `> 인용`, `- 항목`, `1. 항목`, `` `code` ``, `---` 입력 → 각 요소가 본문 폭 760px 안에서 구분되어 보인다.
2. 시스템 설정 > 화면 모드를 다크로 전환 → 앱을 재시작하지 않아도 배경과 글자색이 바뀐다.
3. `|3x2|` 뒤 공백 입력 → 표 생성, 셀 테두리가 보인다. Tab으로 다음 셀 이동.
4. `[ ] 할 일` 입력 → 체크박스 마커 `☐`가 글머리 자리에 보인다(클릭 동작은 Task 2).
5. `~~취소~~` 입력 → 취소선.

- [ ] **Step 4: Commit**

```bash
git add src/app.css
git commit -m "feat(editor): 본문 타이포그래피와 다크 모드 스타일 추가"
```

---

### Task 2: 작업 목록 체크박스 클릭 토글

**Files:**
- Modify: `src/markdown-editor.ts` (`toggleTaskItem` 추가, `taskToggle` 플러그인 등록)
- Modify: `src/markdown-editor.test.ts` (`setup`이 `editor`도 반환, 테스트 2개 추가)

**Interfaces:**
- Consumes: gfm 프리셋의 `list_item` 노드. `attrs.checked`는 작업 목록이면 `boolean`, 일반 항목이면 `null`. DOM은 `li[data-item-type="task"]`.
- Produces: `export function toggleTaskItem(view: EditorView, pos: number): boolean`. `pos`는 `list_item` 노드의 위치. 토글했으면 `true`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/markdown-editor.test.ts`의 `setup` 반환값에 `editor`를 추가한다.

```ts
  return { handle: editorHandle(editor), type, runUndo, editor };
```

import에 `toggleTaskItem`을 추가하고 파일 끝에 테스트를 붙인다.

```ts
import { createMarkdownEditor, editorHandle, toggleTaskItem } from "./markdown-editor";
```

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/markdown-editor.test.ts`
Expected: FAIL. `toggleTaskItem`이 export되지 않음.

- [ ] **Step 3: `toggleTaskItem`과 클릭 플러그인 구현**

`src/markdown-editor.ts`에 추가한다. import: `EditorView` 타입은 `@milkdown/kit/prose/view`.

```ts
import type { EditorView } from "@milkdown/kit/prose/view";

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
```

`createMarkdownEditor`의 체인에 `.use(taskToggle)`을 `.use(gfm)` 뒤에 추가한다.

- [ ] **Step 4: 테스트와 타입 체크**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS.

- [ ] **Step 5: 수동 확인**

Run: `pnpm tauri dev`

1. `[ ] 할 일` 입력 → `☐` 클릭 → `☑`로 바뀌고 글자에 취소선, 타이틀에 `•`.
2. 다시 클릭 → `☐`. `Cmd+Z` → `☑`로 되돌아간다.
3. 체크 상태로 저장 → 파일에 `- [x] 할 일`.
4. 글자 부분 클릭 → 토글되지 않고 캐럿만 이동.
5. 체크박스 클릭 직후 한글 입력 → 자소 분리 없음.

- [ ] **Step 6: Commit**

```bash
git add src/markdown-editor.ts src/markdown-editor.test.ts
git commit -m "feat(editor): 작업 목록 체크박스 클릭 토글 추가"
```

---

### Task 3: 코드 블록 구문 강조

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`@milkdown/plugin-prism` 추가)
- Modify: `src/markdown-editor.ts` (`.use(prism)`)
- Modify: `src/app.css` (토큰 색상)
- Modify: `src/markdown-editor.test.ts` (테스트 2개 추가)

**Interfaces:**
- Consumes: 2단계 `codeBlockWithMeta`의 `attrs.language`. Prism 플러그인은 `code_block` 노드의 `language`로 refractor 언어를 고른다.
- Produces: `pre code` 안 `span.token.<종류>` 인라인 데코레이션. DOM만 바뀌고 모델과 마크다운은 그대로다.

- [ ] **Step 1: 의존성 설치**

Run: `pnpm add @milkdown/plugin-prism`
Expected: `@milkdown/plugin-prism 7.22.3`과 `refractor 5.x`가 설치된다. `@milkdown/prose` 버전은 kit과 같은 7.22.3 하나만 남아야 한다(`pnpm why @milkdown/prose`로 확인).

- [ ] **Step 2: 실패하는 테스트 작성**

`src/markdown-editor.test.ts` 끝에 추가한다. `root`는 이미 파일 상단에서 `let root: HTMLElement | null`로 선언되어 있다.

```ts
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
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test src/markdown-editor.test.ts`
Expected: `highlights code block tokens` FAIL (`.token.keyword`가 없음). 두 번째는 PASS여도 된다.

- [ ] **Step 4: 플러그인 등록**

`src/markdown-editor.ts`:

```ts
import { prism } from "@milkdown/plugin-prism";
```

체인에 `.use(prism)`을 `.use(history)` 뒤에 추가한다. refractor 기본 export는 common 언어 묶음(ts, js, css, json, bash, python, rust, markdown 등 약 36개)이다. 모르는 언어는 플러그인이 `console.warn`만 찍고 데코레이션을 건너뛴다.

- [ ] **Step 5: 토큰 색상 추가**

`src/app.css` 끝에 추가한다. refractor 5는 테마 CSS를 배포하지 않으므로 직접 쓴다.

```css
.token.comment, .token.prolog, .token.cdata { color: #6a737d; }
.token.keyword, .token.tag, .token.important, .token.selector { color: #d73a49; }
.token.string, .token.attr-value, .token.char, .token.regex { color: #032f62; }
.token.number, .token.boolean, .token.constant, .token.symbol { color: #005cc5; }
.token.function, .token.class-name, .token.attr-name { color: #6f42c1; }
.token.operator, .token.punctuation { color: var(--muted); }

@media (prefers-color-scheme: dark) {
  .token.comment, .token.prolog, .token.cdata { color: #8b949e; }
  .token.keyword, .token.tag, .token.important, .token.selector { color: #ff7b72; }
  .token.string, .token.attr-value, .token.char, .token.regex { color: #a5d6ff; }
  .token.number, .token.boolean, .token.constant, .token.symbol { color: #79c0ff; }
  .token.function, .token.class-name, .token.attr-name { color: #d2a8ff; }
}
```

- [ ] **Step 6: 테스트와 타입 체크**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS.

- [ ] **Step 7: 수동 확인**

Run: `pnpm tauri dev`

1. ```` ```ts ```` 입력 후 Enter → 코드 블록. `const x = 1;` 입력 → `const`가 키워드 색.
2. 코드 블록 안에서 `// 한글 주석` 입력 → 자소 분리 없음, 주석 색.
3. 2단계 테스트 파일(```` ```js title=example {1,3} ````)을 열고 저장 → meta가 유지된다(`git diff` 없음).
4. 다크 모드 전환 → 토큰 색이 바뀐다.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/markdown-editor.ts src/markdown-editor.test.ts src/app.css
git commit -m "feat(editor): Prism 코드 블록 구문 강조 추가"
```

---

### Task 4: 이미지 에셋 저장 커맨드와 asset 프로토콜 설정

**Files:**
- Modify: `src-tauri/src/fs.rs` (`save_asset` 추가, 테스트 3개)
- Modify: `src-tauri/src/lib.rs` (`generate_handler!`에 `fs::save_asset` 등록)
- Modify: `src-tauri/tauri.conf.json` (`assetProtocol`, `dragDropEnabled`)
- Modify: `src/lib/tauri.ts` (`saveAsset`, `assetUrl`)

**Interfaces:**
- Produces (Rust): `save_asset(dir: String, file_name: String, data: Vec<u8>) -> Result<String, String>`. `<dir>/assets/`를 만들고 `file_name`으로 쓴다. 같은 이름이 있으면 `<stem>-1.<ext>`, `<stem>-2.<ext>` 순으로 피한다. 반환값은 문서 폴더 기준 상대 경로 `assets/<실제 파일명>`.
- Produces (TS, `src/lib/tauri.ts`):
  - `export function saveAsset(dir: string, fileName: string, data: number[]): Promise<string>`
  - `export function assetUrl(path: string): string` (`convertFileSrc` 래퍼)

- [ ] **Step 1: 실패하는 Rust 테스트 작성**

`src-tauri/src/fs.rs`의 `mod tests` 끝에 추가한다.

```rust
    #[test]
    fn save_asset_writes_under_assets_and_returns_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let rel = save_asset(dir.path().to_string_lossy().into(), "a.png".into(), vec![1, 2, 3]).unwrap();
        assert_eq!(rel, "assets/a.png");
        assert_eq!(fs::read(dir.path().join("assets/a.png")).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn save_asset_adds_suffix_on_collision() {
        let dir = tempfile::tempdir().unwrap();
        let d: String = dir.path().to_string_lossy().into();
        save_asset(d.clone(), "a.png".into(), vec![1]).unwrap();
        let second = save_asset(d.clone(), "a.png".into(), vec![2]).unwrap();
        let third = save_asset(d, "a.png".into(), vec![3]).unwrap();
        assert_eq!(second, "assets/a-1.png");
        assert_eq!(third, "assets/a-2.png");
        assert_eq!(fs::read(dir.path().join("assets/a.png")).unwrap(), vec![1]);
    }

    #[test]
    fn save_asset_rejects_path_traversal_and_hidden_names() {
        let dir = tempfile::tempdir().unwrap();
        let d: String = dir.path().to_string_lossy().into();
        assert!(save_asset(d.clone(), "../x.png".into(), vec![1]).is_err());
        assert!(save_asset(d.clone(), ".hidden".into(), vec![1]).is_err());
        assert!(save_asset(d, "".into(), vec![1]).is_err());
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd src-tauri && cargo test`
Expected: 컴파일 에러. `save_asset`이 없음.

- [ ] **Step 3: `save_asset` 구현**

`src-tauri/src/fs.rs`. 기존 `use std::path::PathBuf;`를 `use std::path::{Path, PathBuf};`로 바꾸고 함수를 추가한다.

```rust
// ponytail: data는 JSON 배열로 넘어온다. 수 MB 이미지가 느리면 tauri::ipc::Request raw body로 교체.
#[tauri::command]
pub fn save_asset(dir: String, file_name: String, data: Vec<u8>) -> Result<String, String> {
    if file_name.is_empty() || file_name.starts_with('.') || file_name.contains(['/', '\\']) {
        return Err(format!("invalid asset file name: {file_name}"));
    }
    let assets = Path::new(&dir).join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (file_name.clone(), String::new()),
    };
    for n in 0..100u32 {
        let name = if n == 0 { file_name.clone() } else { format!("{stem}-{n}{ext}") };
        match OpenOptions::new().write(true).create_new(true).open(assets.join(&name)) {
            Ok(mut file) => {
                file.write_all(&data).map_err(|e| e.to_string())?;
                return Ok(format!("assets/{name}"));
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(format!("too many assets named {file_name}"))
}
```

`src-tauri/src/lib.rs`의 `generate_handler!`에 `fs::save_asset`을 추가한다.

```rust
        .invoke_handler(tauri::generate_handler![
            fs::read_markdown,
            fs::save_markdown_atomic,
            fs::save_asset
        ])
```

- [ ] **Step 4: Rust 테스트와 lint**

Run: `cd src-tauri && cargo fmt && cargo clippy && cargo test`
Expected: 경고 없음, 테스트 9개 PASS.

- [ ] **Step 5: `tauri.conf.json` 수정**

`app.windows[0]`에 `"dragDropEnabled": false`를 추가한다. Tauri의 네이티브 드롭 핸들러가 켜져 있으면 웹뷰 `drop` 이벤트에 파일이 실리지 않아 Milkdown upload 플러그인의 `handleDrop`이 동작하지 않는다.

`app.security`를 다음으로 바꾼다.

```json
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["$HOME/**"]
      }
    }
```

`$HOME` 밖(예: `/Volumes`) 문서의 이미지는 깨진 이미지로 보인다. 필요하면 scope에 경로를 추가한다.

- [ ] **Step 6: `src/lib/tauri.ts`에 래퍼 추가**

```ts
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

// ponytail: number[]는 JSON으로 직렬화된다. 큰 이미지가 느리면 Uint8Array raw body와 헤더로 교체.
export function saveAsset(dir: string, fileName: string, data: number[]): Promise<string> {
  return invoke<string>("save_asset", { dir, fileName, data });
}

export function assetUrl(path: string): string {
  return convertFileSrc(path);
}
```

Tauri v2는 JS의 `fileName`을 Rust 인자 `file_name`에 자동으로 맞춘다.

- [ ] **Step 7: 타입 체크와 수동 확인**

Run: `pnpm tsc --noEmit && pnpm tauri dev`

1. 앱이 뜬다. 개발자 도구 콘솔에서 `window.__TAURI_INTERNALS__.convertFileSrc("/tmp/x.png")`를 실행 → `asset://localhost/%2Ftmp%2Fx.png` 형태 문자열.
2. 콘솔에서 `window.__TAURI_INTERNALS__.invoke("save_asset", { dir: "/tmp", fileName: "a.png", data: [1,2,3] })` → `"assets/a.png"`. `/tmp/assets/a.png`가 3바이트다.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/fs.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src/lib/tauri.ts
git commit -m "feat(fs): 이미지 에셋 저장 커맨드와 asset 프로토콜 설정"
```

---

### Task 5: 로컬 이미지 렌더링과 붙여넣기 저장

**Files:**
- Create: `src/lib/image-asset.ts`
- Create: `src/lib/image-asset.test.ts`
- Modify: `src/markdown-editor.ts` (`documentPath` ctx, `imageSrc` 데코레이션 플러그인, `upload` 설정, `setFilePath`)
- Modify: `src/markdown-editor.test.ts` (`vi.mock("./lib/tauri")`, 테스트 7개 추가)
- Modify: `src/editor.tsx` (`EditorHandle`에 `setFilePath` 추가)
- Modify: `src/app.tsx` (`newDocument`, `openDocument`, `saveDocument`에서 `setFilePath` 호출)

**Interfaces:**
- Consumes: Task 4 `saveAsset`, `assetUrl`, 기존 `showError` (`src/lib/tauri.ts`). commonmark `image` 노드(`attrs: { src, alt, title }`, inline atom, `nodeSize` 1). `@milkdown/kit/plugin/upload`의 `upload`, `uploadConfig` (`uploader(files: FileList, schema: Schema, ctx: Ctx, insertPos: number): Promise<Node[]>`).
- Produces (`src/lib/image-asset.ts`):
  - `export function imageFilePath(src: string, documentPath: string | null): string | null`. 마크다운 URL을 `decodeURIComponent`로 풀고(실패하면 원문 그대로) 상대 경로를 문서 폴더 기준 절대 경로로 바꾼다. 스킴이 있는 URL(`https:`, `data:`), 빈 문자열, 문서 경로가 없는 상대 경로는 `null`.
  - `export function relativeImageSrc(absolutePath: string, documentPath: string): string`. 절대 경로를 문서 폴더 기준 상대 경로로 바꾸고 공백, `%`, `#`, `?`만 퍼센트 인코딩한다. `imageFilePath`의 역함수.
  - `export function assetFileName(name: string, type: string, now: Date): string`. 파일명에서 글자, 숫자, `.`, `_`, `-` 외 문자는 `-`로 바꾼다. 클립보드가 주는 일반 이름(`image.png`, 빈 이름)은 `image-YYYYMMDD-HHMMSS.<ext>`로, 그 외는 원래 이름 유지.
- Produces (`src/editor.tsx`): `EditorHandle.setFilePath(path: string | null): void`
- Produces (`src/markdown-editor.ts`): `editorHandle(editor)` 반환값에 `setFilePath` 포함. 폴더가 바뀌면 상대 경로 이미지의 `src`를 다시 써서 원래 파일을 계속 가리키게 하고, 이때는 `onChange`가 발생한다.

- [ ] **Step 1: 순수 함수 테스트 작성**

`src/lib/image-asset.test.ts`:

```ts
import { expect, it } from "vitest";
import { assetFileName, imageFilePath, relativeImageSrc } from "./image-asset";

it.each([
  ["assets/a.png", "/docs/n.md", "/docs/assets/a.png"],
  ["./a.png", "/docs/n.md", "/docs/a.png"],
  ["../img/a.png", "/docs/sub/n.md", "/docs/img/a.png"],
  ["../../a.png", "/n.md", "/a.png"],
  ["my%20pic.png", "/docs/n.md", "/docs/my pic.png"],
  ["chart%231.png", "/docs/n.md", "/docs/chart#1.png"],
  ["100%.png", "/docs/n.md", "/docs/100%.png"],
  ["/abs/a.png", "/docs/n.md", "/abs/a.png"],
  ["/abs/a.png", null, "/abs/a.png"],
  ["https://example.com/a.png", "/docs/n.md", null],
  ["data:image/png;base64,AAAA", "/docs/n.md", null],
  ["a.png", null, null],
  ["", "/docs/n.md", null],
])("imageFilePath(%j, %j) = %j", (src, doc, expected) => {
  expect(imageFilePath(src, doc)).toBe(expected);
});

it.each([
  ["/a/assets/p.png", "/a/n.md", "assets/p.png"],
  ["/a/assets/p.png", "/b/n.md", "../a/assets/p.png"],
  ["/a/sub/p.png", "/a/sub/deep/n.md", "../p.png"],
  ["/a/my pic.png", "/b/n.md", "../a/my%20pic.png"],
  ["/a/chart#1.png", "/a/n.md", "chart%231.png"],
  ["/a/100%.png", "/a/n.md", "100%25.png"],
])("relativeImageSrc(%j, %j) = %j", (abs, doc, expected) => {
  expect(relativeImageSrc(abs, doc)).toBe(expected);
  expect(imageFilePath(expected, doc)).toBe(abs);
});

const now = new Date(2026, 9, 19, 15, 30, 12);

it.each([
  ["image.png", "image/png", "image-20261019-153012.png"],
  ["", "image/jpeg", "image-20261019-153012.jpg"],
  ["photo.JPG", "image/jpeg", "photo.JPG"],
  ["blob", "image/webp", "blob.webp"],
  ["100%.png", "image/png", "100-.png"],
  ["chart#1.png", "image/png", "chart-1.png"],
  ["내 사진.png", "image/png", "내-사진.png"],
])("assetFileName(%j, %j) = %j", (name, type, expected) => {
  expect(assetFileName(name, type, now)).toBe(expected);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/lib/image-asset.test.ts`
Expected: FAIL. `Cannot find module './image-asset'`.

- [ ] **Step 3: `src/lib/image-asset.ts` 구현**

```ts
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function imageFilePath(src: string, documentPath: string | null): string | null {
  if (src === "" || SCHEME.test(src)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    decoded = src; // `100%.png`처럼 인코딩되지 않은 원문 파일명
  }
  if (decoded.startsWith("/")) return decoded;
  if (documentPath === null) return null;
  const parts = documentPath.split("/").slice(0, -1);
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

export function relativeImageSrc(absolutePath: string, documentPath: string): string {
  const from = documentPath.split("/").slice(1, -1);
  const to = absolutePath.split("/").slice(1);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  return rel.replace(/[ %#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function assetFileName(name: string, type: string, now: Date): string {
  // 마크다운 URL에서 인코딩이 필요한 문자를 파일명에서 미리 없앤다.
  const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot + 1) : (EXT_BY_MIME[type] ?? "png");
  if (stem !== "" && stem !== "image") return `${stem}.${ext}`;
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `image-${stamp}.${ext}`;
}
```

Run: `pnpm test src/lib/image-asset.test.ts`
Expected: PASS.

- [ ] **Step 4: 에디터 테스트 작성**

`src/markdown-editor.test.ts` 상단 import에 추가하고 mock을 둔다. `vi.mock`은 호이스팅되므로 import 뒤에 있어도 된다.

```ts
import { editorViewCtx, schemaCtx, type Editor } from "@milkdown/kit/core";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import type { Node } from "@milkdown/kit/prose/model";
import { saveAsset, showError } from "./lib/tauri";

vi.mock("./lib/tauri", () => ({
  assetUrl: (path: string) => `asset://localhost${path}`,
  saveAsset: vi.fn(async (_dir: string, fileName: string) => `assets/${fileName}`),
  showError: vi.fn(async () => {}),
}));
```

`afterEach`에 `vi.mocked(saveAsset).mockClear(); vi.mocked(showError).mockClear();`를 추가한다.

ProseMirror는 줄 끝 인라인 atom 뒤에 `img.ProseMirror-separator`를 붙이므로 실제 이미지는 `img:not(.ProseMirror-separator)`로 고른다.

```ts
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
  expect(onChange).toHaveBeenCalledTimes(1);
  handle.setFilePath("/a/n.md");
  expect(handle.getValue()).toBe("![pic](assets/p.png) ![abs](/x/q.png) ![web](https://example.com/r.png)\n");
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
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm test src/markdown-editor.test.ts`
Expected: FAIL. `handle.setFilePath is not a function`.

- [ ] **Step 6: `EditorHandle`에 `setFilePath` 추가**

`src/editor.tsx`:

```ts
/**
 * 에디터 본문 접근 인터페이스.
 * `setValue`는 `onChange`를 발생시키지 않아야 한다. 핸들은 Milkdown 생성이 끝나기 전까지 `null`이다.
 * `setFilePath`는 상대 경로 이미지의 기준 폴더와 붙여넣은 이미지의 저장 위치를 정한다. `setValue`보다 먼저 호출한다.
 * 문서 폴더가 바뀌면 상대 경로 이미지가 원래 파일을 계속 가리키도록 `src`를 다시 쓰므로 이때는 `onChange`가 발생한다.
 */
export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  setFilePath(path: string | null): void;
}
```

- [ ] **Step 7: `src/markdown-editor.ts` 구현**

import 추가:

```ts
import { Editor, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { upload, uploadConfig } from "@milkdown/kit/plugin/upload";
import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $ctx, $prose, getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { assetFileName, imageFilePath, relativeImageSrc } from "./lib/image-asset";
import { assetUrl, saveAsset, showError } from "./lib/tauri";
```

문서 경로 슬라이스와 이미지 데코레이션. `toDOM`을 바꾸지 않는다. `replaceAll`은 `view.updateState`를 쓰고 ProseMirror는 `node.eq`가 참인 노드의 DOM을 재사용하므로, `toDOM`에서 경로를 풀면 같은 이미지를 가진 다른 문서를 열어도 화면이 갱신되지 않는다. 노드 데코레이션은 상태마다 다시 비교되므로 `src` 속성이 항상 현재 경로를 따른다. 클립보드 직렬화는 `toDOM`만 쓰므로 asset URL이 모델로 되돌아올 일도 없다.

```ts
// 현재 문서 경로. 이미지 상대 경로의 기준 폴더이자 붙여넣은 이미지의 저장 위치다.
const documentPath = $ctx<string | null, "documentPath">(null, "documentPath");
const IMAGE_SRC_KEY = new PluginKey<DecorationSet>("imageSrc");
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

// 화면의 img src만 asset URL로 바꾼다. 모델과 클립보드 직렬화(toDOM)는 원문 경로를 유지한다.
// ponytail: 문서가 바뀔 때마다 이미지 노드를 전부 훑는다. 큰 문서에서 느리면 tr.mapping으로 옮기고 바뀐 범위만 다시 만든다.
const imageSrc = $prose((ctx) => {
  const build = (doc: Node) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== "image") return;
      const file = imageFilePath(node.attrs.src, ctx.get(documentPath.key));
      // 항상 src를 넣는다. 데코레이션이 사라지면 ProseMirror가 속성을 지워 img가 빈 src로 남는다.
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { src: file === null ? node.attrs.src : assetUrl(file) }));
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
```

업로더. 실패해도 절대 throw하지 않는다. upload 플러그인은 `uploader`가 reject하면 자리표시자를 지우지 않고 `console.error`만 남긴다.

```ts
async function uploadImages(files: FileList, ctx: Ctx): Promise<Node[]> {
  const path = ctx.get(documentPath.key);
  if (path === null) {
    await showError("이미지를 넣으려면 먼저 문서를 저장하세요.");
    return [];
  }
  const image = ctx.get(schemaCtx).nodes.image!;
  const nodes: Node[] = [];
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      const src = await saveAsset(dirOf(path), assetFileName(file.name, file.type, new Date()), data);
      nodes.push(image.create({ src, alt: src.slice("assets/".length).replace(/\.[^.]*$/, "") }));
    } catch (err) {
      await showError(String(err));
    }
  }
  return nodes;
}
```

`createMarkdownEditor`의 `.config`에 추가:

```ts
      ctx.update(uploadConfig.key, (prev) => ({
        ...prev,
        uploader: (files, _schema, ctx) => uploadImages(files, ctx),
      }));
```

체인에 `.use(documentPath)`, `.use(imageSrc)`, `.use(upload)`를 추가한다. 순서: `commonmark`, `codeBlockWithMeta`, `gfm`, `taskToggle`, `history`, `prism`, `upload`, `documentPath`, `imageSrc`, `docChanged`.

`editorHandle`에 추가:

```ts
    setFilePath: (path) =>
      editor.action((ctx) => {
        const prev = ctx.get(documentPath.key);
        ctx.set(documentPath.key, path);
        const view = ctx.get(editorViewCtx);
        const tr = view.state.tr.setMeta(IMAGE_SRC_KEY, true).setMeta("addToHistory", false);
        // 다른 폴더로 저장하면 상대 경로 이미지가 원래 파일을 계속 가리키도록 경로를 다시 쓴다. 같은 함수로 되돌릴 수 있다.
        if (prev !== null && path !== null && dirOf(prev) !== dirOf(path)) {
          view.state.doc.descendants((node, pos) => {
            if (node.type.name !== "image" || node.attrs.src.startsWith("/")) return;
            const file = imageFilePath(node.attrs.src, prev);
            if (file !== null) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: relativeImageSrc(file, path) });
          });
        }
        view.dispatch(tr);
      }),
```

이미지 노드는 `nodeSize`가 1이라 `setNodeMarkup`을 여러 번 해도 위치가 밀리지 않는다. `src`가 바뀐 경우에만 `tr.docChanged`가 참이 되어 `docChanged` 플러그인이 `onChange`를 부른다.

- [ ] **Step 8: `src/app.tsx` 호출부 수정**

`newDocument`: `h.setValue("")` 앞에 `h.setFilePath(null);`
`openDocument`: `h.setValue(content)` 앞에 `h.setFilePath(path);`
`saveDocument`: 경로를 먼저 알려서 상대 경로 이미지를 다시 쓴 뒤 본문을 꺼낸다. 쓰기에 실패하면 이전 경로로 되돌린다.

```ts
  function saveDocument(path: string) {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      // 다른 폴더면 상대 경로 이미지를 새 위치 기준으로 다시 쓴다. getValue보다 먼저 불러야 한다.
      h.setFilePath(path);
      const source = h.getValue();
      try {
        await saveMarkdownAtomic(path, formatMarkdown(source));
      } catch (err) {
        h.setFilePath(filePath);
        throw err;
      }
      setFilePath(path);
      if (h.getValue() !== source) return;
      setIsDirty(false);
    });
  }
```

`setFilePath`가 이미지를 다시 쓰면 `onChange`로 `isDirty`가 켜지지만, 바로 뒤의 `getValue()`가 그 결과를 `source`로 잡으므로 저장 후 `setIsDirty(false)`까지 정상 도달한다.

- [ ] **Step 9: 테스트와 타입 체크**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS. 기존 2단계 테스트(front matter, code fence meta)도 그대로 통과한다.

- [ ] **Step 10: 수동 확인**

Run: `pnpm tauri dev`

1. 새 문서에서 스크린샷(`Cmd+Ctrl+Shift+4`) 붙여넣기 → "이미지를 넣으려면 먼저 문서를 저장하세요." 다이얼로그, 본문에 "Upload in progress..."가 남지 않는다.
2. `~/tmp/doc.md`로 저장 후 같은 붙여넣기 → `~/tmp/assets/image-YYYYMMDD-HHMMSS.png` 생성, 본문에 이미지 표시. 저장 → 파일에 `![image-YYYYMMDD-HHMMSS](assets/image-YYYYMMDD-HHMMSS.png)`.
3. Finder에서 `내 사진.png`를 창으로 드래그 앤 드롭 → `assets/내-사진.png`로 복사되고 드롭 위치에 삽입.
4. 같은 PNG를 다시 드롭 → `assets/내-사진-1.png`.
5. `Cmd+Shift+S`로 `~/tmp2/doc.md`에 저장 → 이미지가 계속 보이고 파일에 `../tmp/assets/...`가 적힌다. `Cmd+N` 후 `~/tmp2/doc.md`를 열어도 이미지가 보인다.
6. `~/tmp/doc.md`와 같은 내용(`![pic](assets/p.png)`)의 파일을 `~/other/doc.md`에 두고 두 파일을 차례로 열기 → 각자 자기 폴더의 이미지를 보여준다.
7. 파일에 `![x](https://picsum.photos/200)`를 적고 열기 → 원격 이미지 표시. `![y](missing.png)` → 깨진 이미지 아이콘(에러 다이얼로그 없음).
8. 이미지를 클릭 → 선택 외곽선. Backspace → 삭제, 타이틀 `•`.
9. 이미지 삽입 직후 한글 입력 → 자소 분리 없음.

- [ ] **Step 11: Commit**

```bash
git add src/lib/image-asset.ts src/lib/image-asset.test.ts src/markdown-editor.ts src/markdown-editor.test.ts src/editor.tsx src/app.tsx
git commit -m "feat(editor): 로컬 이미지 렌더링과 붙여넣기 저장 추가"
```

---

### Task 6: GFM 수동 검증과 문서 갱신

**Files:**
- Modify: `docs/PLAN.md` (3단계 체크박스, 상세 태스크 링크, 기술 스택 표 스타일링 행, 2단계 알려진 문제의 체크 상태 항목)
- Modify: `AGENTS.md` (`EditorHandle` 설명에 `setFilePath` 반영)

**Interfaces:**
- Consumes: Task 1~5 결과물 전체

- [ ] **Step 1: GFM 수동 검증**

Run: `pnpm tauri dev`

다음 내용의 파일을 만들어 연다.

```markdown
# GFM

| 이름 | 값 |
| --- | --- |
| a | 1 |

- [x] 끝난 일
- [ ] 남은 일

~~취소~~ 텍스트[^1]

[^1]: 각주 내용
```

확인 항목:
1. 표가 테두리와 함께 보이고 셀 안에서 한글 입력이 된다. Tab으로 다음 셀, Shift+Tab으로 이전 셀. 마지막 셀에서 Tab → 새 행.
2. `끝난 일`은 `☑`와 취소선, `남은 일`은 `☐`. 클릭으로 토글.
3. `~~취소~~`가 취소선. 각주 참조가 위첨자, 정의가 본문 아래 구분선 밑에 보인다.
4. 아무것도 바꾸지 않고 `Cmd+S` → 파일 내용이 열기 전과 같다(표 정렬 공백 정도의 차이는 기록).
5. 다크 모드에서 1~3 다시 확인.

실패한 항목은 `docs/PLAN.md` 3단계 아래 "알려진 문제"로 기록한다.

- [ ] **Step 2: `docs/PLAN.md` 갱신**

- 3단계 절 아래에 `상세 태스크: [\`superpowers/plans/2026-10-19-phase3-typora-ui.md\`](superpowers/plans/2026-10-19-phase3-typora-ui.md)` 줄을 2단계와 같은 형식으로 추가한다.
- 3단계 체크박스 4개를 `[x]`로 바꾼다. 구문 강조 항목은 "`@milkdown/plugin-prism` 적용(Shiki는 번들 크기 때문에 제외)"으로 고친다.
- 기술 스택 표의 스타일링 행을 `| 스타일링 | 순수 CSS (CSS 변수 + prefers-color-scheme) | 3단계에서 Tailwind 대신 선택. 에디터 본문 하나뿐이라 유틸리티 클래스가 필요 없음 |`로 바꾼다.
- 2단계 알려진 문제의 "작업 목록 체크 상태가 화면에 표시되지 않음" 항목을 "→ 3단계에서 해결"로 표시한다.
- Step 1에서 기록한 알려진 문제가 있으면 3단계 아래에 추가한다.

- [ ] **Step 3: `AGENTS.md` 갱신**

"에디터 본문은 React 상태에 두지 않는다" 항목의 `EditorHandle { getValue, setValue }`를 `EditorHandle { getValue, setValue, setFilePath }`로 바꾼다.

- [ ] **Step 4: Commit**

```bash
git add docs/PLAN.md AGENTS.md
git commit -m "docs(plan): 3단계 완료 표시와 순수 CSS 선택 기록"
```
