# 2단계: Milkdown 에디터 코어 교체 및 단방향 바인딩 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<textarea>`를 Milkdown 위지윅 에디터로 교체하되, `EditorHandle` 인터페이스와 `app.tsx`의 문서 흐름은 그대로 유지한다.

**Architecture:** Milkdown 연결은 React와 분리된 순수 팩토리 `src/markdown-editor.ts`(`createMarkdownEditor`, `editorHandle`)에 둔다. `src/editor.tsx`는 이 팩토리를 `useEffect`에서 생성하고 완료 시점에 `handleRef.current`를 채우는 얇은 컴포넌트가 된다. 본문은 Milkdown 인스턴스가 단일 진실 공급원이며 React 상태로 올라가지 않는다. `setValue`는 `replaceAll(value, true)`로 에디터 상태를 새로 만들어 히스토리를 비우고 listener를 건드리지 않는다. Prettier는 제거하고 저장 직전 포매팅은 LF 정규화와 끝 개행 보장만 남긴다. Milkdown의 remark-stringify 출력은 결정적이라 Prettier가 다시 고치면(`*강조*` → `_강조_`) 저장할 때마다 본문 교체와 캐럿 이동이 발생하기 때문이다.

**Tech Stack:** Tauri v2, React 19, TypeScript, Vite 8, Vitest 5 + jsdom, `@milkdown/kit` 7.22 (`core`, `preset/commonmark`, `preset/gfm`, `plugin/listener`, `plugin/history`, `utils`)

**Spec:** `docs/PLAN.md` 2단계 절

## Global Constraints

- 새 의존성은 `@milkdown/kit`(runtime), `jsdom`(dev)으로 제한한다. `@milkdown/react`, 테마 패키지(`@milkdown/theme-nord`, `@milkdown/crepe`)는 쓰지 않는다. `prettier`는 제거한다.
- `EditorHandle { getValue(): string; setValue(value: string): void }` 시그니처는 바꾸지 않는다. `app.tsx` 변경은 `await formatMarkdown(...)`에서 `await` 제거 한 곳뿐이다.
- `setValue`는 `onChange`를 발생시키지 않는다. 타이핑 중 React 리렌더는 `setIsDirty(true)` 첫 호출 한 번뿐이다.
- `handleRef.current`는 Milkdown `create()`가 끝나기 전까지 `null`이다. `app.tsx`는 `null`이면 동작을 중단한다(1단계 동작 유지).
- `getValue()` 출력은 항상 LF이고 끝 개행이 정확히 하나다. 빈 문서는 `""`.
- `remarkStringifyOptionsCtx`는 `ctx.set`이 아니라 `ctx.update`로 바꾼다. `ctx.set`은 Milkdown이 넣어둔 `handlers`를 지워 직렬화를 깨뜨린다.
- 스타일은 `src/app.css`의 `.ProseMirror` 규칙 몇 줄로 제한한다. 타이포그래피와 다크 모드는 3단계.
- 커밋 메시지는 `docs/conventions/commit-convention.md`를 따른다.

## Review Focus

- 열기 직후 200ms 안에 들어온 listener 이벤트(이전 문서의 타이핑 잔여분)가 새 문서를 더티로 만들지 않음. Task 2 테스트 `ignores change pending before setValue`.
- front matter(`---\ntitle: x\n---`)는 commonmark 파서가 구분선과 setext 제목으로 해석해 `***`와 `## title: x`로 바뀐다. 이 계획에서는 고치지 않는다. Task 3 수동 확인 항목 7에서 결과를 기록한다.
- 본문 안의 `_`와 `*`(예: `snake_case`)는 `snake\_case`로 이스케이프된다. remark-stringify 고유 동작이며 이 계획에서는 고치지 않는다. Task 3 수동 확인 항목 8.
- 파일 열기 또는 새 문서 직후 `Cmd+Z`가 이전 문서를 되살리지 않음(`replaceAll(_, true)`가 히스토리를 비움). Task 2 수동 확인 항목 6.
- 앱 시작 직후 핸들이 `null`인 동안 `Cmd+O`는 무시됨. Task 2 수동 확인 항목 1.

---

### Task 1: Prettier 제거와 동기 포매터

**Files:**

- Modify: `src/lib/format-markdown.ts`
- Modify: `src/lib/format-markdown.test.ts` (전체 교체)
- Modify: `src/app.tsx` (`saveDocument` 안의 `await formatMarkdown(source)` → `formatMarkdown(source)`)
- Modify: `package.json`, `pnpm-lock.yaml` (`prettier` 제거)

**Interfaces:**

- Produces: `export function formatMarkdown(source: string): string` (동기)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/format-markdown.test.ts` 전체를 다음으로 교체한다.

```ts
import { expect, it } from "vitest";
import { formatMarkdown } from "./format-markdown";

it("converts CRLF to LF", () => expect(formatMarkdown("a\r\nb\r\n")).toBe("a\nb\n"));
it("adds trailing newline", () => expect(formatMarkdown("a")).toBe("a\n"));
it("collapses trailing newlines to one", () => expect(formatMarkdown("a\n\n\n")).toBe("a\n"));
it("keeps empty document empty", () => expect(formatMarkdown("")).toBe(""));
it("is idempotent", () => expect(formatMarkdown(formatMarkdown("* a\r\n"))).toBe("* a\n"));
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test src/lib/format-markdown.test.ts`
Expected: FAIL. `formatMarkdown("a")`가 Promise를 반환해 `toBe` 불일치.

- [ ] **Step 3: `formatMarkdown` 구현**

`src/lib/format-markdown.ts`를 동기 함수로 교체한다. CRLF와 CR을 LF로 바꾸고, 빈 문자열이 아니면 끝 개행을 정확히 하나로 맞춘다. 리스트 기호 통일은 이제 포매터 책임이 아니다(Task 2의 `bullet: "-"`).

- [ ] **Step 4: `app.tsx` 호출부 수정**

`saveDocument`에서 `const formatted = await formatMarkdown(source);` → `const formatted = formatMarkdown(source);`. 다른 줄은 손대지 않는다.

- [ ] **Step 5: 의존성 제거와 검증**

Run: `pnpm remove prettier && pnpm tsc --noEmit && pnpm test`
Expected: 타입 에러 없음, 전체 PASS

Run: `pnpm build && grep -l prettier dist/assets/*.js`
Expected: 출력 없음(Prettier 청크 없음)

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/format-markdown.ts src/lib/format-markdown.test.ts src/app.tsx
git commit -m "feat(format): Prettier 제거하고 LF 정규화와 끝 개행만 남김"
```

---

### Task 2: Milkdown 에디터 팩토리와 컴포넌트 교체

**Files:**

- Create: `src/markdown-editor.ts`
- Create: `src/markdown-editor.test.ts`
- Modify: `src/editor.tsx` (textarea 구현 전체 교체, `EditorHandle` 인터페이스는 유지)
- Modify: `src/app.css` (`.ProseMirror` 규칙 추가)
- Modify: `package.json`, `pnpm-lock.yaml` (`@milkdown/kit` 추가, `jsdom` dev 추가)

**Interfaces:**

- Consumes: `src/editor.tsx`의 `EditorHandle` (타입 import), Task 1 `formatMarkdown`
- Produces (`src/markdown-editor.ts`):
  - `export function createMarkdownEditor(root: HTMLElement, onChange: () => void): Promise<Editor>` (`Editor`는 `@milkdown/kit/core`의 Milkdown 에디터)
  - `export function editorHandle(editor: Editor): EditorHandle`
- Produces (`src/editor.tsx`): `export function Editor(props: { handleRef: React.RefObject<EditorHandle | null>; onChange: () => void }): JSX.Element` (시그니처 변경 없음)

- [ ] **Step 1: 의존성 설치**

Run: `pnpm add @milkdown/kit && pnpm add -D jsdom`

- [ ] **Step 2: 실패하는 테스트 작성**

`src/markdown-editor.test.ts`. listener가 200ms 디바운스라 실시간 타이머로 300ms 기다린다.

````ts
// @vitest-environment jsdom
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, expect, it, vi } from "vitest";
import { formatMarkdown } from "./lib/format-markdown";
import { createMarkdownEditor, editorHandle } from "./markdown-editor";

const wait = () => new Promise((r) => setTimeout(r, 300));
const onChange = vi.fn();
let destroy: () => Promise<void> = async () => {};

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
````

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test src/markdown-editor.test.ts`
Expected: FAIL, `Cannot find module './markdown-editor'`

- [ ] **Step 4: `src/markdown-editor.ts` 구현**

`createMarkdownEditor(root, onChange)`:

```ts
Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, root);
    ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: "-" }));
    ctx.get(listenerCtx).updated(() => onChange());
  })
  .use(commonmark)
  .use(gfm)
  .use(history)
  .use(listener)
  .create();
```

import 경로: `Editor, rootCtx, remarkStringifyOptionsCtx, editorViewCtx` ← `@milkdown/kit/core`, `commonmark` ← `@milkdown/kit/preset/commonmark`, `gfm` ← `@milkdown/kit/preset/gfm`, `history` ← `@milkdown/kit/plugin/history`, `listener, listenerCtx` ← `@milkdown/kit/plugin/listener`, `getMarkdown, replaceAll` ← `@milkdown/kit/utils`.

`editorHandle(editor)`:

- `getValue`: `editor.action(getMarkdown())`
- `setValue`: `editor.action(replaceAll(value, true))`. `flush = true`가 필수다. `false`면 교체가 히스토리에 쌓여 `Cmd+Z`로 이전 파일이 되살아나고, listener `apply`를 거쳐 `onChange`가 발생한다.

`markdownUpdated` 대신 `updated`를 쓴다. `markdownUpdated`는 디바운스마다 문서 전체를 직렬화한다. `isDirty`에는 문자열이 필요 없다.

listener는 200ms 디바운스라 `setValue` 직전 타이핑 이벤트가 새 문서 뒤에 도착할 수 있다. `replaceAll(_, true)`는 새 plugins 배열로 상태를 만들고, ProseMirror는 plugins 배열이 바뀌면 플러그인 뷰를 재생성하므로 listener의 `destroy`가 대기 중인 디바운스를 취소할 것으로 예상한다. 그래서 가드 없이 시작한다. 테스트 `ignores change pending before setValue`가 실패하면 그때만 다음 가드를 넣는다.

```ts
ctx.get(listenerCtx).updated((ctx, doc) => {
  // 현재 상태의 doc이 아니면 setValue 이전 문서의 잔여 이벤트다.
  if (doc === ctx.get(editorViewCtx).state.doc) onChange();
});
```

`gfm`은 3단계 항목이지만 지금 넣는다. commonmark만 쓰면 표의 `|`, 작업 목록의 `[ ]`, `~~`가 일반 텍스트로 파싱되어 저장 시 이스케이프되거나 평문화된다. 한 줄이고 추가 의존성이 없다.

- [ ] **Step 5: `src/editor.tsx` 교체**

`EditorHandle` 인터페이스와 주석은 유지하고, 주석에 "핸들은 Milkdown 생성이 끝나기 전까지 `null`이다"를 반영한다. 컴포넌트는 `<div ref={rootRef} />` 하나를 렌더하고 `useEffect`에서 팩토리를 호출한다.

`onChange` prop은 `app.tsx`가 매 렌더마다 새 함수를 넘긴다(`() => setIsDirty(true)`). `useRef`에 최신 값을 담고 이펙트 의존성은 `[]`로 둔다. `onChange`가 의존성에 들어가면 첫 타이핑에서 에디터가 재생성되어 본문이 사라진다.

StrictMode는 이펙트를 두 번 실행한다. `create()`가 비동기라 첫 번째 생성이 두 번째보다 늦게 끝나면 stale 핸들이 남을 수 있으므로 취소 플래그로 막는다.

```ts
useEffect(() => {
  let cancelled = false;
  let handle: EditorHandle | null = null;
  const creating = createMarkdownEditor(rootRef.current!, () => onChangeRef.current());
  creating.then((e) => {
    if (cancelled) return e.destroy();
    handle = handleRef.current = editorHandle(e);
  });
  return () => {
    cancelled = true;
    void creating.then((e) => {
      if (handle === null) return; // 생성 완료 전 취소: 위 then이 이미 destroy했다
      if (handleRef.current === handle) handleRef.current = null;
      return e.destroy();
    });
  };
}, []);
```

같은 Promise에 등록한 `then`은 등록 순서대로 실행된다. 생성 전에 취소되면 첫 번째 `then`이 destroy하고 `handle`은 `null`로 남아 두 번째가 빠져나간다. 생성 후에 취소되면 두 번째 `then`이 자기 핸들일 때만 `handleRef`를 비운다. 두 번째 마운트의 핸들을 건드리지 않는다.

- [ ] **Step 6: `src/app.css`에 ProseMirror 기본 규칙 추가**

Milkdown은 CSS를 포함하지 않는다. `prosemirror-view/style/prosemirror.css`는 pnpm 엄격 의존성 때문에 import할 수 없으므로 직접 쓴다.

```css
.ProseMirror {
  white-space: pre-wrap;
  word-wrap: break-word;
  outline: none;
  min-height: 100vh;
  padding: 16px;
  box-sizing: border-box;
  font:
    16px/1.6 system-ui,
    sans-serif;
}
```

- [ ] **Step 7: 테스트와 타입 체크**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 에러 없음, 전체 PASS (`markdown-editor.test.ts` 5개 포함)

- [ ] **Step 8: 수동 검증**

Run: `pnpm tauri dev`

확인 항목:

1. 앱이 뜨자마자 `Cmd+O` → 아무 일도 없거나 다이얼로그가 뜬다. 에러 다이얼로그는 안 뜬다.
2. 타이핑 → 타이틀 `• Untitled`. 이후 타이핑은 타이틀 변화 없음.
3. `* a` 입력 → 리스트로 변환 → `Cmd+S` → `test.md` 저장 → 파일 내용 `- a\n`. 캐럿이 맨 앞으로 튀지 않는다.
4. `Cmd+S`를 한 번 더 → 파일 내용 변화 없음(`git diff` 또는 `cat`으로 확인).
5. `Cmd+N` → 빈 문서, 타이틀 `Untitled`. `Cmd+O` → `test.md` → 본문 로드, 타이틀 `test.md`(더티 표시 없음). 1초 기다려도 `•`가 붙지 않는다.
6. 열기 직후 `Cmd+Z` → 본문 변화 없음(빈 문서로 돌아가지 않음).
7. 타이핑 후 `Cmd+Z` → 되돌아감. `Cmd+Shift+Z` → 다시 실행.
8. 타이핑 후 창 닫기 → 경고 → 취소 → 창과 본문 유지.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/markdown-editor.ts src/markdown-editor.test.ts src/editor.tsx src/app.css
git commit -m "feat(editor): textarea를 Milkdown 에디터로 교체"
```

---

### Task 3: 한글 IME 검증과 계획 문서 갱신

**Files:**

- Modify: `docs/PLAN.md` (2단계 체크박스, 기술 스택 표 Prettier 행, 3단계 gfm 항목)

**Interfaces:**

- Consumes: Task 2 결과물 전체

- [ ] **Step 1: 한글 IME 수동 검증**

Run: `pnpm tauri dev`. macOS 기본 두벌식 입력기로 확인한다.

확인 항목(각 항목에서 자소 분리, 마지막 글자 누락, 글자 중복이 없어야 한다):

1. `# ` 입력 → 제목 변환 → 이어서 `안녕하세요` 입력.
2. `- ` 입력 → 리스트 변환 → 이어서 `첫 번째 항목` 입력 → Enter → `두 번째` 입력.
3. `**굵게**` 입력 → 굵게 변환 → 이어서 ` 다음 글자` 입력.
4. 문장 중간에 캐럿을 두고 `한글` 삽입.
5. `가나다` 입력 후 Backspace 세 번 → 빈 줄. 조합 중(예: `ㄱ` 상태) Backspace → 조합 취소.
6. 조합 중(예: `안녕하세` 뒤에 `ㅇ` 상태) `Cmd+S` → 저장 후 조합이 이어지거나 완성된 글자로 남는다. 글자가 사라지지 않는다.
7. `---\ntitle: x\n---\n본문` 내용의 파일을 열고 저장 → 결과를 기록한다(front matter가 원문 그대로 보존됨).
8. `snake_case 와 a*b` 입력 후 저장 → 파일 내용을 기록한다(`snake_case`는 유지, `a\*b` 예상).

실패한 항목은 `docs/PLAN.md` 2단계 아래에 "알려진 문제" 목록으로 적는다. IME 항목(1~6)이 실패하면 이 계획 범위 밖이므로 수정 여부를 사용자와 정한다.

- [ ] **Step 2: `docs/PLAN.md` 갱신**

- 2단계 체크박스 전부 `[x]`. "Prettier 제거 여부 판단" 항목 뒤에 "→ 제거함(remark-stringify 출력이 결정적이고 Prettier와 충돌)"을 덧붙인다.
- 기술 스택 표의 "마크다운 포매터" 행을 제거하거나 "제거됨(2단계). 저장 시 LF 정규화와 끝 개행만 적용"으로 바꾼다.
- 3단계 `@milkdown/preset-gfm` 항목을 "GFM 렌더링 검증(표 편집, 체크박스 토글, 각주). 프리셋 연동은 2단계에서 선행"으로 바꾼다.
- Step 1에서 기록한 알려진 문제가 있으면 2단계 아래에 추가한다.

- [ ] **Step 3: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs(plan): 2단계 완료 표시와 Prettier 제거 결정 기록"
```
