# 1단계: 파일 앱 뼈대 및 안전한 I/O 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<textarea>` 기반 에디터에서 마크다운 파일 열기, 원자적 저장, 더티 상태 추적, 단축키, 미저장 경고를 완성한다.

**Architecture:** Rust 커맨드 두 개(`read_markdown`, `save_markdown_atomic`)가 파일 I/O를 담당한다. 프론트엔드는 본문을 React 상태에 두지 않고 `EditorHandle` 인터페이스(`getValue`/`setValue`) 뒤에 숨긴다. 2단계에서 textarea를 Milkdown으로 바꿀 때 이 인터페이스만 다시 구현하면 된다. React 상태는 `filePath`와 `isDirty` 두 개만 가진다. 순수 함수(포매터, 타이틀, 단축키 매칭)는 Vitest로 검증하고, Tauri 연동 부분은 `pnpm tauri dev`로 수동 검증한다.

**Tech Stack:** Tauri v2, React 19, TypeScript, Vite 8, Vitest, `@tauri-apps/plugin-dialog`, `prettier/standalone` + `prettier/plugins/markdown`, Rust `std::fs`, `tempfile`(dev)

**Spec:** `docs/PLAN.md` 1단계 절

## Global Constraints

- 타이핑 중 React 리렌더링 금지. 본문은 React 상태로 올리지 않는다.
- 저장 경로: 에디터 문자열 추출 → Prettier 포매팅 → Rust 원자적 저장. 포매팅은 저장 시점에만 수행한다.
- 포매팅 실패(파싱 에러) 시 원본 문자열을 그대로 저장한다.
- Prettier는 정적 import 금지. 첫 저장 시 `import()`로 지연 로드한다.
- 저장 결과는 항상 LF 개행이다.
- 원자적 저장: 같은 디렉토리의 임시 파일에 쓰고 `rename`으로 교체한다. 쓰기 도중 실패해도 원본은 남는다.
- 단축키: `Cmd+N` 새 문서, `Cmd+O` 열기, `Cmd+S` 저장, `Cmd+Shift+S` 다른 이름으로 저장.
- 타이틀바: 더티 상태면 파일명 앞에 `• `를 붙인다. 경로 없는 문서는 `Untitled`.
- 새 의존성 추가는 `vitest`, `prettier`, `tempfile`(Rust dev)로 제한한다.

## Review Focus

- 열기/다른 이름으로 저장 다이얼로그 취소(`null` 반환): 상태(`filePath`, `isDirty`, 본문) 변화 없음. 테스트 불가(네이티브 다이얼로그), Task 6에서 수동 확인.
- Prettier가 파싱하지 못하는 입력: 원본 문자열 그대로 반환. Task 2 테스트.
- CRLF 입력: 저장 결과 LF. Task 2 테스트.
- `Cmd+Shift+S`가 `Cmd+S`로 오인되지 않음. Task 4 테스트.
- 더티 상태에서 창 닫기 취소: 창 유지, 본문 유지. Task 7에서 수동 확인.
- 저장 도중 쓰기 실패(디스크 가득 참 등): 원본 파일 유지, 임시 파일 잔존 금지. Task 1 테스트는 성공 경로와 덮어쓰기만 검증한다. 실패 경로는 코드 리뷰로 확인한다.

---

### Task 1: Rust 파일 I/O 커맨드

**Files:**
- Create: `src-tauri/src/fs.rs`
- Modify: `src-tauri/src/lib.rs` (`greet` 제거, `fs` 모듈 등록)
- Modify: `src-tauri/Cargo.toml` (`[dev-dependencies] tempfile = "3"`)

**Interfaces:**
- Produces: `#[tauri::command] pub fn read_markdown(path: String) -> Result<String, String>`
- Produces: `#[tauri::command] pub fn save_markdown_atomic(path: String, content: String) -> Result<(), String>`
- 에러는 `e.to_string()`으로 변환한 문자열. 프론트엔드는 `invoke` 거부 값으로 받는다.

- [ ] **Step 1: `fs.rs`에 실패하는 테스트 작성**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn save_then_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        save_markdown_atomic(path.to_string_lossy().into(), "# hi\n".into()).unwrap();
        assert_eq!(read_markdown(path.to_string_lossy().into()).unwrap(), "# hi\n");
    }

    #[test]
    fn save_overwrites_existing_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, "old").unwrap();
        save_markdown_atomic(path.to_string_lossy().into(), "new".into()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn read_missing_file_is_err() {
        assert!(read_markdown("/nonexistent/x.md".into()).is_err());
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd src-tauri && cargo test`
Expected: 컴파일 에러 (`read_markdown`, `save_markdown_atomic` 미정의)

- [ ] **Step 3: `fs.rs` 구현**

`save_markdown_atomic`: 임시 파일 경로는 `path.with_file_name(format!("{file_name}.tmp"))`. `fs::write(tmp)` 후 `File::open(tmp)?.sync_all()`, 그 다음 `fs::rename(tmp, path)`. 어느 단계든 실패하면 `fs::remove_file(tmp)`를 시도한 뒤(결과 무시) 에러 반환.

```rust
// ponytail: rename은 원본 inode를 교체하므로 원본의 권한/xattr은 유지되지 않는다. 필요해지면 metadata 복사 추가.
```

`lib.rs`: `mod fs;`, `greet` 삭제, `invoke_handler(tauri::generate_handler![fs::read_markdown, fs::save_markdown_atomic])`.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd src-tauri && cargo test`
Expected: `test result: ok. 3 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fs.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: 마크다운 읽기 및 원자적 저장 Rust 커맨드 추가"
```

---

### Task 2: Vitest 설정 및 Prettier 마크다운 포매터

**Files:**
- Modify: `package.json` (`vitest`, `prettier` 추가, `"test": "vitest run"` 스크립트)
- Create: `src/lib/format-markdown.ts`
- Test: `src/lib/format-markdown.test.ts`

**Interfaces:**
- Produces: `export async function formatMarkdown(source: string): Promise<string>`

- [ ] **Step 1: 의존성 설치**

Run: `pnpm add -D vitest && pnpm add prettier`

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { formatMarkdown } from "./format-markdown";

describe("formatMarkdown", () => {
  it("normalizes list markers and trailing newline", async () => {
    expect(await formatMarkdown("* a\n* b")).toBe("- a\n- b\n");
  });

  it("converts CRLF to LF", async () => {
    expect(await formatMarkdown("# t\r\n\r\ntext\r\n")).toBe("# t\n\ntext\n");
  });

  it("returns source unchanged when formatting throws", async () => {
    vi.doMock("prettier/standalone", () => ({
      format: () => {
        throw new Error("boom");
      },
    }));
    vi.resetModules();
    const { formatMarkdown: mocked } = await import("./format-markdown");
    expect(await mocked("x")).toBe("x");
  });
});
```

세 번째 테스트는 `format`을 직접 throw하게 모킹한다. Prettier는 마크다운 안의 깨진 코드 블록을 조용히 넘기므로 실제 입력으로는 예외를 재현하기 어렵다. `import { describe, expect, it, vi } from "vitest"`로 `vi`를 추가한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test`
Expected: FAIL, `Cannot find module './format-markdown'`

- [ ] **Step 4: `format-markdown.ts` 구현**

`prettier/standalone`과 `prettier/plugins/markdown`은 정적 import 금지. 함수 안에서 `await import()`로 지연 로드해 콜드 스타트에서 Prettier 파싱 비용을 뺀다. 첫 저장 때 한 번 로드되고 이후 모듈 캐시에 남는다.

```ts
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
    return source;
  }
}
```

`import()` 실패(청크 로드 실패)도 같은 `catch`로 떨어져 원본을 저장한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS 3

- [ ] **Step 6: 청크 분리 확인**

Run: `pnpm build && ls dist/assets`
Expected: `index-*.js` 외에 Prettier가 담긴 별도 청크(`standalone-*.js`, `markdown-*.js` 등)가 존재. `index-*.js`에 `prettier` 문자열이 없음: `grep -L prettier dist/assets/index-*.js`가 파일명 출력.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/format-markdown.ts src/lib/format-markdown.test.ts
git commit -m "feat: Prettier standalone 마크다운 포매터 추가"
```

---

### Task 3: 창 타이틀 문자열 함수

**Files:**
- Create: `src/lib/window-title.ts`
- Test: `src/lib/window-title.test.ts`

**Interfaces:**
- Produces: `export function windowTitle(filePath: string | null, isDirty: boolean): string`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { expect, it } from "vitest";
import { windowTitle } from "./window-title";

it("untitled clean", () => expect(windowTitle(null, false)).toBe("Untitled"));
it("untitled dirty", () => expect(windowTitle(null, true)).toBe("• Untitled"));
it("file clean uses basename", () =>
  expect(windowTitle("/Users/me/notes/todo.md", false)).toBe("todo.md"));
it("file dirty", () =>
  expect(windowTitle("/Users/me/notes/todo.md", true)).toBe("• todo.md"));
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test`
Expected: FAIL, `Cannot find module './window-title'`

- [ ] **Step 3: `window-title.ts` 구현**

basename은 `filePath.split("/").pop()`. Node `path` 모듈 사용 금지(브라우저 번들).

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/window-title.ts src/lib/window-title.test.ts
git commit -m "feat: 창 타이틀 문자열 생성 함수 추가"
```

---

### Task 4: 단축키 매칭 함수

**Files:**
- Create: `src/lib/document-shortcuts.ts`
- Test: `src/lib/document-shortcuts.test.ts`

**Interfaces:**
- Produces: `export type DocumentAction = "new" | "open" | "save" | "saveAs"`
- Produces: `export function matchShortcut(e: Pick<KeyboardEvent, "metaKey" | "shiftKey" | "key">): DocumentAction | null`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { expect, it } from "vitest";
import { matchShortcut } from "./document-shortcuts";

const k = (key: string, shift = false, meta = true) => ({ key, shiftKey: shift, metaKey: meta });

it("cmd+n", () => expect(matchShortcut(k("n"))).toBe("new"));
it("cmd+o", () => expect(matchShortcut(k("o"))).toBe("open"));
it("cmd+s", () => expect(matchShortcut(k("s"))).toBe("save"));
it("cmd+shift+s is saveAs, not save", () => expect(matchShortcut(k("S", true))).toBe("saveAs"));
it("without meta is null", () => expect(matchShortcut(k("s", false, false))).toBeNull());
it("unrelated key is null", () => expect(matchShortcut(k("k"))).toBeNull());
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test`
Expected: FAIL, `Cannot find module './document-shortcuts'`

- [ ] **Step 3: `document-shortcuts.ts` 구현**

`key.toLowerCase()`로 비교. Shift 눌리면 `key`가 대문자 `"S"`로 오므로 소문자 변환 필수. `saveAs` 분기를 `save`보다 먼저 검사.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/document-shortcuts.ts src/lib/document-shortcuts.test.ts
git commit -m "feat: 문서 단축키 매칭 함수 추가"
```

---

### Task 5: Tauri 래퍼, 권한, textarea 에디터 컴포넌트

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/editor.tsx`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: Task 1 커맨드 이름 `read_markdown`, `save_markdown_atomic`
- Produces (`src/lib/tauri.ts`):
  - `export function readMarkdown(path: string): Promise<string>`
  - `export function saveMarkdownAtomic(path: string, content: string): Promise<void>`
  - `export function pickOpenPath(): Promise<string | null>` — `open({ multiple: false, directory: false, filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] })`
  - `export function pickSavePath(defaultPath?: string): Promise<string | null>` — `save({ defaultPath, filters: 동일 })`
  - `export function confirmDiscard(): Promise<boolean>` — `ask("저장하지 않은 변경 사항이 있습니다. 버리시겠습니까?", { title: "mini-mark", kind: "warning", okLabel: "버리기", cancelLabel: "취소" })`
  - `export function setWindowTitle(title: string): Promise<void>` — `getCurrentWindow().setTitle`
- Produces (`src/editor.tsx`):
  - `export interface EditorHandle { getValue(): string; setValue(value: string): void }`
  - `export function Editor(props: { handleRef: React.RefObject<EditorHandle | null>; onChange: () => void }): JSX.Element`
  - 비제어 `<textarea>`. `useImperativeHandle(handleRef, ...)`로 `getValue`/`setValue`를 DOM `value`에 직접 연결. `onChange`는 `onInput`에서 호출. 본문을 React 상태에 두지 않는다.

- [ ] **Step 1: 권한 추가**

`default.json`의 `permissions`에 `"core:window:allow-set-title"`, `"dialog:allow-ask"` 추가.

- [ ] **Step 2: `src/lib/tauri.ts` 작성**

위 시그니처대로. `invoke("read_markdown", { path })`, `invoke("save_markdown_atomic", { path, content })`.

- [ ] **Step 3: `src/editor.tsx` 작성**

위 시그니처대로. 스타일은 `width: 100%; height: 100vh; resize: none; border: 0; font: 14px/1.6 monospace; padding: 16px` 인라인 또는 `app.css`.

- [ ] **Step 4: 타입 체크**

Run: `pnpm tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/editor.tsx src-tauri/capabilities/default.json
git commit -m "feat: Tauri 래퍼와 textarea 에디터 컴포넌트 추가"
```

---

### Task 6: 문서 상태와 열기/저장/새 문서 흐름 연결

**Files:**
- Rename: `src/App.tsx` → `src/app.tsx` (`git mv`, 내용 전체 교체)
- Rename: `src/App.css` → `src/app.css` (`git mv`, 템플릿 스타일 제거, 본문/html 마진 0)
- Modify: `src/main.tsx` (import 경로 `./app`)
- Delete: `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg`

**Interfaces:**
- Consumes: Task 2 `formatMarkdown`, Task 3 `windowTitle`, Task 4 `matchShortcut`, Task 5 전체
- Produces: 없음 (최상위 컴포넌트)

- [ ] **Step 1: `app.tsx` 작성**

상태: `const [filePath, setFilePath] = useState<string | null>(null)`, `const [isDirty, setIsDirty] = useState(false)`, `const editor = useRef<EditorHandle>(null)`.

함수:
- `newDocument()`: `editor.current.setValue("")`, `setFilePath(null)`, `setIsDirty(false)`
- `openDocument()`: `pickOpenPath()` → `null`이면 반환 → `readMarkdown` → `setValue` → `setFilePath(path)`, `setIsDirty(false)`
- `saveDocument(path: string)`: `formatMarkdown(getValue())` → `saveMarkdownAtomic(path, formatted)` → 포매팅 결과가 원본과 다르면 `setValue(formatted)` → `setFilePath(path)`, `setIsDirty(false)`
- `save()`: `filePath`가 있으면 `saveDocument(filePath)`, 없으면 `saveAs()`
- `saveAs()`: `pickSavePath(filePath ?? "Untitled.md")` → `null`이면 반환 → `saveDocument(path)`
- 모든 실패는 `catch`에서 `message(String(err), { kind: "error" })`(dialog 플러그인)로 표시.

이펙트:
- `useEffect(() => { setWindowTitle(windowTitle(filePath, isDirty)) }, [filePath, isDirty])`
- `useEffect`로 `window.addEventListener("keydown", ...)` 등록. `matchShortcut(e)`가 `null`이 아니면 `e.preventDefault()` 후 해당 함수 호출. 핸들러는 `useRef`에 최신 함수를 담아 리스너를 한 번만 등록한다.

렌더: `<Editor handleRef={editor} onChange={() => setIsDirty(true)} />`

주의: `setIsDirty(true)`는 이미 `true`면 React가 리렌더를 건너뛴다. 타이핑 중 리렌더는 첫 입력 한 번뿐이다.

- [ ] **Step 2: 타입 체크와 테스트**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 에러 없음, 테스트 전부 PASS

- [ ] **Step 3: 수동 검증**

Run: `pnpm tauri dev`

확인 항목:
1. 시작 시 타이틀 `Untitled`.
2. 타이핑 후 타이틀 `• Untitled`.
3. `Cmd+S` → 저장 다이얼로그 → 취소 → 타이틀 그대로 `• Untitled`, 본문 유지.
4. `Cmd+S` → `test.md`로 저장 → 타이틀 `test.md`. 파일 내용이 LF, 끝에 개행 하나.
5. `* item` 입력 후 `Cmd+S` → 본문이 `- item`으로 바뀜.
6. `Cmd+Shift+S` → 다른 이름 저장 다이얼로그.
7. `Cmd+N` → 빈 본문, 타이틀 `Untitled`.
8. `Cmd+O` → 취소 → 상태 변화 없음. 다시 `Cmd+O` → `test.md` 선택 → 본문 로드.
9. 읽기 권한 없는 파일 열기(`chmod 000`) → 에러 다이얼로그, 기존 상태 유지.

- [ ] **Step 4: Commit**

```bash
git mv src/App.tsx src/app.tsx && git mv src/App.css src/app.css
git add src/app.tsx src/app.css src/main.tsx
git rm src/assets/react.svg public/vite.svg public/tauri.svg
git commit -m "feat: 문서 열기, 저장, 새 문서 흐름과 단축키 연결"
```

---

### Task 7: 미저장 경고 방어

**Files:**
- Modify: `src/app.tsx`
- Modify: `docs/PLAN.md` (1단계 체크박스 완료 표시)

**Interfaces:**
- Consumes: Task 5 `confirmDiscard`, `@tauri-apps/api/window`의 `getCurrentWindow().onCloseRequested`

- [ ] **Step 1: 열기와 새 문서에 가드 추가**

`newDocument`와 `openDocument` 시작부에 `if (isDirty && !(await confirmDiscard())) return;`.

- [ ] **Step 2: 창 닫기 가로채기**

`useEffect`에서 `getCurrentWindow().onCloseRequested(async (event) => { if (isDirtyRef.current && !(await confirmDiscard())) event.preventDefault(); })`. 반환된 `unlisten`을 cleanup에서 호출. `isDirty`는 `useRef`로 미러링해 리스너를 한 번만 등록한다.

```ts
// ponytail: 버리기/취소 2버튼. 저장/버리기/취소 3버튼이 필요하면 커스텀 모달로 교체.
```

- [ ] **Step 3: 수동 검증**

Run: `pnpm tauri dev`

확인 항목:
1. 타이핑 후 `Cmd+N` → 경고 → 취소 → 본문 유지. 다시 `Cmd+N` → 버리기 → 빈 문서.
2. 타이핑 후 `Cmd+O` → 경고 → 취소 → 열기 다이얼로그 안 뜸.
3. 타이핑 후 창 닫기(`Cmd+W` 또는 빨간 버튼) → 경고 → 취소 → 창 유지, 본문 유지.
4. 같은 상태에서 다시 닫기 → 버리기 → 창 닫힘.
5. 저장 직후 닫기 → 경고 없이 닫힘.

- [ ] **Step 4: `docs/PLAN.md` 1단계 체크박스 `[x]` 처리**

- [ ] **Step 5: Commit**

```bash
git add src/app.tsx docs/PLAN.md
git commit -m "feat: 미저장 상태에서 닫기, 열기, 새 문서 시 경고 추가"
```
