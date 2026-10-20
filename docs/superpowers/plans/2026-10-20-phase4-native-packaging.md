# 4단계: macOS 네이티브 통합 및 패키징 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finder에서 `.md`를 열면 앱이 받고, 외부 변경을 감지해 다시 불러오고, File 메뉴와 최근 파일 목록을 제공하고, 성능 목표를 측정한 뒤 `.app`과 `.dmg`를 만든다.

**Architecture:** Finder 연동은 `tauri.conf.json`의 `bundle.fileAssociations`와 Rust `RunEvent::Opened` 처리로 끝낸다. 콜드 스타트 때는 웹뷰가 아직 없으므로 Rust가 경로를 `OpenedFile` 상태에 보관하고, 프론트엔드가 리스너 등록과 에디터 준비를 모두 마친 뒤 `take_opened_file`로 가져간다. 이 호출이 `ready` 플래그를 세우고, 그 뒤의 `Opened`는 `open-file` 이벤트로만 전달한다(보관과 이벤트가 겹치지 않는다). 문서를 바꾸는 모든 동작(메뉴, Finder 열기, 외부 변경 폴링)은 `app.tsx`의 `guarded` 진입점 하나를 거쳐 직렬화한다. 최근 파일 목록은 Rust가 소유한다(`recent-files.json`을 앱 데이터 폴더에 저장하고 File > Open Recent 서브메뉴를 다시 그린다). 메뉴 항목 선택도 모두 Rust가 `document-action`, `open-file` 이벤트로 프론트엔드에 넘기고, 프론트엔드의 `app.tsx`가 기존 `actions`에 연결한다. 외부 변경 감지는 Rust 명령 `file_modified_at`을 프론트엔드가 2초마다 호출하는 폴링으로 구현한다(새 크레이트 없음). 폴링 한 회는 `src/lib/file-watch.ts`의 `pollFileChange`가 담당하고, 읽기가 끝난 뒤 문서 경로와 더티 여부를 다시 확인해 그 사이 바뀐 문서를 덮어쓰지 않는다. 프론트엔드 로직(`nextWatchAction`, `pollFileChange`)과 Rust 순수 로직(`push_recent`, `first_file_path`)만 단위 테스트하고 나머지는 디버그 번들로 수동 검증한다.

**Tech Stack:** Tauri 2.12 (`RunEvent::Opened`, `Emitter`, `menu::Submenu`, `Manager::path().app_data_dir()`), `@tauri-apps/api/event` `listen`, React 19, TypeScript, Vitest 5, serde_json(이미 의존성), `cargo test`

**Spec:** `docs/PLAN.md` 4단계 절

## Global Constraints

- 새 runtime 의존성(npm, cargo 모두)을 추가하지 않는다. `notify`, `tauri-plugin-fs`, `tauri-plugin-store`는 쓰지 않는다. 파일 감시는 `std::fs::metadata` 폴링, 영속 저장은 `serde_json` + `std::fs`로 한다.
- `EditorHandle` 인터페이스(`getValue`, `setValue`, `setFilePath`)는 바꾸지 않는다. `Editor` 컴포넌트 prop에 `onReady: () => void`만 추가한다.
- Tauri 호출은 모두 `src/lib/tauri.ts`를 거친다. `app.tsx`에서 `invoke`, `listen`을 직접 쓰지 않는다.
- Rust 커맨드 에러는 `Result<T, String>`. 커맨드명은 snake_case이고 `invoke` 문자열과 같다.
- 이벤트 이름과 페이로드: `open-file`(payload `string` 절대 경로), `document-action`(payload `"new" | "open" | "save" | "saveAs"`). 메뉴 항목 id는 `new`, `open`, `save`, `saveAs`, `clear-recent`, `recent:<index>`.
- 메뉴 문구는 기존 메뉴와 같이 영어(`File`, `New`, `Open...`, `Open Recent`, `Clear Menu`, `Save`, `Save As...`). 대화상자 문구는 기존처럼 한국어.
- 단축키 `Cmd+N/O/S/Shift+S`는 File 메뉴 항목의 accelerator로 옮기고 `window.addEventListener("keydown")` 경로와 `src/lib/document-shortcuts.ts`는 삭제한다. 메뉴 accelerator가 키 입력을 먼저 소비하므로 두 경로를 함께 두면 저장이 두 번 실행될 수 있다.
- 성능 목표는 `docs/PLAN.md` 1절 그대로: 번들 10MB 이하, 유휴 메모리 100MB 이내. 콜드 스타트 1초 이내, 2MB 문서 타이핑 입력 지연 100ms 이내를 추가 목표로 둔다. 미달 항목은 수치와 함께 `docs/PLAN.md` 4단계 알려진 문제에 적는다.
- 코드 서명과 공증은 하지 않는다(Apple Developer 계정 필요). 미서명 배포 안내만 남긴다.
- 파일과 식별자 이름은 `docs/conventions/naming-convention.md`, 커밋 메시지는 `docs/conventions/commit-convention.md`를 따른다. 모든 텍스트에 가운뎃점 문자를 쓰지 않는다.

## Review Focus

- Finder에서 `.md` 파일 두 개를 선택해 열기: 첫 파일만 열리고 나머지는 무시된다(단일 창 앱). `RunEvent::Opened`의 `urls`에 `file://`이 아닌 URL이 섞여도 패닉 없이 건너뛴다. Task 1 테스트 `first_file_path_picks_first_file_url`.
- 편집 중인 파일을 외부에서 삭제하거나 이름을 바꿈: 경고 없이 계속 편집되고 `Cmd+S`로 같은 경로에 다시 만들어진다. Task 2 테스트 `nextWatchAction` `current === null`은 `"none"`.
- 자기 저장 직후 폴링 틱: 자신의 저장을 외부 변경으로 오인해 다시 불러오지 않는다(저장 중 `knownMtime`을 `null`로 비워 감시를 멈춘다). Task 2 테스트 `known === null`은 `"none"`.
- 폴링이 A를 읽는 동안 사용자가 B를 열거나 글자를 입력: A 본문이 B에 들어가거나 입력이 사라지면 안 된다. 틱은 `busy`를 잡아 메뉴 동작과 겹치지 않고, 읽기 후 경로와 더티 여부를 다시 확인한다. Task 2 테스트 `discards the read when the document changed meanwhile`, `discards the read when the user typed meanwhile`.
- 다시 불러오기 읽기 실패: 오류 대화상자가 한 번 뜨고 2초마다 반복되지 않는다. Task 2 테스트 `propagates read errors without touching the baseline`(소비는 `app.tsx`의 `tick`이 한다)과 수동 확인 7번.
- 콜드 스타트에서 `take_opened_file` 직후 `Opened` 도착: 유실도 중복 열기도 없다. Task 1 테스트 `opened_before_ready_is_stored`, `opened_after_ready_is_not_stored`.
- 같은 파일을 다시 열거나 11번째 파일을 열기: 목록 맨 앞으로 이동하고 중복이 없으며 가장 오래된 항목이 빠진다. Task 3 테스트 `push_recent_moves_duplicate_to_front`, `push_recent_keeps_at_most_ten`.
- `recent-files.json`이 없거나 깨짐: 빈 목록으로 시작하고 패닉하지 않는다. Task 3 테스트 `load_returns_empty_when_missing_or_invalid`.
- 미저장 변경이 있는 상태에서 Finder로 다른 파일 열기: 기존 "버리기/취소" 확인이 뜨고 취소하면 현재 문서가 유지된다. Task 1 수동 확인 4번.

---

### Task 1: Finder 연동 (`fileAssociations`와 `RunEvent::Opened`)

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.fileAssociations`, `bundle.targets`)
- Modify: `src-tauri/src/lib.rs` (`OpenedFile` 상태, `take_opened_file` 커맨드, `first_file_path`, `.build().run()` 전환, 테스트)
- Modify: `src/lib/tauri.ts` (`takeOpenedFile`, `onOpenFileRequested`)
- Modify: `src/editor.tsx` (`onReady` prop)
- Modify: `src/app.tsx` (`openDocument`를 `openPath(path)`로 분리, 준비 시 `takeOpenedFile`, `open-file` 리스너)

**Interfaces:**
- Produces (Rust, `lib.rs`):
  - `#[derive(Default)] struct OpenedFile { pending: Option<String>, ready: bool }`, managed state는 `Mutex<OpenedFile>`
  - `fn first_file_path(urls: &[tauri::Url]) -> Option<String>`: 첫 `file://` URL을 절대 경로 문자열로. 없으면 `None`.
  - `impl OpenedFile { fn opened(&mut self, path: String) -> Option<String> }`: `ready`면 `Some(path)`를 돌려주고(호출자가 emit), 아니면 `pending`에 보관하고 `None`.
  - `impl OpenedFile { fn take(&mut self) -> Option<String> }`: `ready = true`로 세우고 `pending`을 꺼낸다.
  - `#[tauri::command] fn take_opened_file(state: tauri::State<Mutex<OpenedFile>>) -> Option<String>`: 잠금 안에서 `take()`.
- Produces (TS, `src/lib/tauri.ts`):
  - `export function takeOpenedFile(): Promise<string | null>`
  - `export function onOpenFileRequested(handler: (path: string) => void): Promise<() => void>` (`listen<string>("open-file", ...)` 래퍼, 반환값은 unlisten)
- Produces (TS, `src/editor.tsx`): `Editor` prop `onReady: () => void`. `handleRef.current`가 채워진 직후 한 번 호출한다. `onChange`처럼 ref로 보관해 이펙트 의존성에 넣지 않는다.
- Produces (TS, `src/app.tsx`):
  - `function openPath(path: string): Promise<void>`. 더티 확인, `readMarkdown`, `setFilePath`/`setValue`, 상태 갱신까지 담당한다. 가드를 잡지 않는다. 기존 `openDocument`는 `pickOpenPath()` 뒤 `openPath`를 부른다. Task 2와 Task 3이 이 함수 끝에 호출을 추가한다.
  - `async function guarded(fn: () => Promise<void>): Promise<void>`. `busy.current`가 참이면 아무것도 하지 않고, 아니면 `busy`를 잡고 `fn`을 실행한 뒤 푼다. 기존 keydown 핸들러의 `busy` 처리를 그대로 뽑은 것이다. 이벤트 진입점(keydown, Task 3의 메뉴 이벤트, `open-file` 이벤트, 시작 시 `takeOpenedFile`, Task 2의 폴링 틱)에서만 한 번 부른다. `openPath`, `saveDocument` 같은 문서 함수 안에서는 부르지 않는다(중첩하면 안쪽 호출이 무시된다).

- [ ] **Step 1: `tauri.conf.json`에 파일 연결 추가**

`bundle`에 추가하고 `targets`를 바꾼다.

```json
"targets": ["app", "dmg"],
"fileAssociations": [
  {
    "ext": ["md", "markdown"],
    "name": "Markdown",
    "description": "Markdown document",
    "role": "Editor",
    "mimeType": "text/markdown"
  }
]
```

- [ ] **Step 2: 실패하는 Rust 테스트 작성**

`src-tauri/src/lib.rs` 끝에 추가한다.

```rust
#[cfg(test)]
mod tests {
    use super::first_file_path;
    use tauri::Url;

    #[test]
    fn first_file_path_picks_first_file_url() {
        let urls = [
            Url::parse("https://example.com/a.md").unwrap(),
            Url::parse("file:///Users/me/notes/a%20b.md").unwrap(),
            Url::parse("file:///Users/me/notes/c.md").unwrap(),
        ];
        assert_eq!(first_file_path(&urls).as_deref(), Some("/Users/me/notes/a b.md"));
    }

    #[test]
    fn first_file_path_is_none_without_file_url() {
        let urls = [Url::parse("https://example.com/a.md").unwrap()];
        assert_eq!(first_file_path(&urls), None);
        assert_eq!(first_file_path(&[]), None);
    }

    #[test]
    fn opened_before_ready_is_stored() {
        let mut state = OpenedFile::default();
        assert_eq!(state.opened("/a.md".into()), None);
        assert_eq!(state.opened("/b.md".into()), None); // 마지막 요청이 남는다
        assert_eq!(state.take(), Some("/b.md".to_string()));
        assert_eq!(state.take(), None);
    }

    #[test]
    fn opened_after_ready_is_not_stored() {
        let mut state = OpenedFile::default();
        assert_eq!(state.take(), None);
        assert_eq!(state.opened("/a.md".into()), Some("/a.md".to_string()));
        assert_eq!(state.take(), None);
    }
}
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd src-tauri && cargo test`
Expected: 컴파일 에러. `first_file_path`, `OpenedFile`이 없음.

- [ ] **Step 4: `OpenedFile`, `first_file_path`, `take_opened_file` 구현과 `Opened` 처리**

`lib.rs`:
- `first_file_path`: `urls.iter().filter(|u| u.scheme() == "file").find_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned())`
- `OpenedFile::opened`, `OpenedFile::take`는 인터페이스대로. `tauri::Builder`에 `.manage(Mutex::new(OpenedFile::default()))`, `generate_handler!`에 `take_opened_file` 추가.
- `.run(tauri::generate_context!())`를 `.build(tauri::generate_context!()).expect(...).run(|app, event| { ... })`로 바꾼다. 클로저:

```rust
#[cfg(target_os = "macos")]
if let tauri::RunEvent::Opened { urls } = event
    && let Some(path) = first_file_path(&urls)
    && let Some(path) = app.state::<Mutex<OpenedFile>>().lock().unwrap().opened(path)
{
    use tauri::Emitter;
    // ready 전(콜드 스타트)에는 웹뷰 리스너가 없어 emit이 유실되므로 opened()가 보관하고 None을 돌려준다.
    let _ = app.emit("open-file", path);
}
```

`ponytail:` 주석: 여러 파일을 동시에 열면 첫 파일만 연다. 다중 창이 필요해지면 창을 추가 생성.

- [ ] **Step 5: Rust 테스트와 clippy**

Run: `cd src-tauri && cargo fmt && cargo clippy && cargo test`
Expected: 경고 없음, 전체 PASS.

- [ ] **Step 6: `tauri.ts` 래퍼와 `Editor.onReady`**

`src/lib/tauri.ts`: `import { listen } from "@tauri-apps/api/event";` 추가. `takeOpenedFile`은 `invoke<string | null>("take_opened_file")`. `onOpenFileRequested`는 `listen<string>("open-file", (e) => handler(e.payload))`.

`src/editor.tsx`: prop `onReady`를 받아 `onReadyRef`에 보관하고 `handle = handleRef.current = editorHandle(e);` 다음 줄에서 `onReadyRef.current()`를 호출한다.

- [ ] **Step 7: `app.tsx`에 `openPath`와 리스너 연결**

- 기존 keydown 핸들러의 `busy` 처리를 `guarded`로 뽑고 keydown은 `guarded(() => actions.current[action]())`를 부른다(Task 3에서 keydown 쪽은 삭제된다).
- `openDocument`의 본문 중 `pickOpenPath` 이후를 `openPath(path)`로 뽑는다. `openPath`는 더티 확인에 `isDirtyRef.current`를 쓴다(이벤트 리스너에서 불리면 클로저의 `isDirty`가 낡은 값이다). `openPath` 안에서 `guarded`를 부르지 않는다.
- 시작 시 열기는 리스너 등록과 에디터 준비를 모두 기다린 뒤 한 번만 한다.

`useRef(new Promise(executor))`는 렌더마다 executor가 다시 돌아 resolver가 버려지는 Promise로 바뀐다(StrictMode 이중 렌더에서 재현). `src/lib/deferred.ts`의 `deferred<T>(): { promise, resolve }`를 `useState` 지연 초기화로 한 번만 만든다.

```ts
const [editorReady] = useState(deferred<void>);

useEffect(() => {
  const listening = onOpenFileRequested((p) => void guarded(() => openPath(p)));
  void Promise.all([listening, editorReady.promise]).then(async () => {
    const p = await takeOpenedFile();
    if (p !== null) await guarded(() => openPath(p));
  });
  return () => {
    void listening.then((fn) => fn());
  };
}, []);
```

`<Editor onReady={() => editorReady.resolve()} ...>`. `take_opened_file`이 `ready`를 세우므로 그 뒤 도착한 `Opened`는 이벤트로만 오고, 그 전 것은 반환값으로만 온다.

- [ ] **Step 8: 타입 체크와 테스트**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS.

- [ ] **Step 9: 디버그 번들로 수동 확인**

`pnpm tauri dev` 바이너리에는 Info.plist가 없어 Finder 연결을 시험할 수 없다. 디버그 번들을 만든다.

Run: `pnpm tauri build --debug`
Expected: `src-tauri/target/debug/bundle/macos/mini-mark.app` 생성.

```bash
APP=src-tauri/target/debug/bundle/macos/mini-mark.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
printf '# 열기 테스트\n' > ~/open-test.md
printf '# 두 번째\n' > ~/open-test-2.md
```

1. `open -a "$APP" ~/open-test.md` (콜드 스타트) → 앱이 뜨고 본문 `열기 테스트`, 타이틀 `open-test.md`.
2. 앱이 떠 있는 상태에서 `open -a "$APP" ~/open-test-2.md` → 본문이 `두 번째`로 바뀐다.
3. Finder에서 `open-test.md`를 Dock의 mini-mark 아이콘에 드롭 → 열린다.
4. 본문에 글자를 입력(더티)한 뒤 2번 반복 → "버리기/취소" 확인. 취소하면 현재 문서 유지, 버리기면 새 파일.
5. Finder에서 `open-test.md` 우클릭 > 다음으로 열기 → 목록에 mini-mark가 보인다. 기본 앱으로 설정 후 더블클릭 → 열린다.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs src/lib/tauri.ts src/editor.tsx src/app.tsx
git commit -m "feat(app): Finder 파일 연결과 열기 이벤트 처리 추가"
```

---

### Task 2: 외부 변경 감지와 다시 불러오기

**Files:**
- Modify: `src-tauri/src/fs.rs` (`file_modified_at` 커맨드, 테스트 2개)
- Modify: `src-tauri/src/lib.rs` (`generate_handler!`에 `fs::file_modified_at`)
- Create: `src/lib/file-watch.ts`, `src/lib/file-watch.test.ts`
- Modify: `src/lib/tauri.ts` (`fileModifiedAt`, `confirmReload`)
- Modify: `src/app.tsx` (`knownMtime` ref, 폴링 이펙트, `openPath`/`saveDocument` 갱신)

**Interfaces:**
- Produces (Rust): `#[tauri::command] pub fn file_modified_at(path: String) -> Result<u64, String>`. 수정 시각을 UNIX epoch 기준 밀리초로 반환. 파일이 없으면 `Err`.
- Produces (TS, `src/lib/file-watch.ts`):
  - `export type WatchAction = "none" | "reload" | "ask"`
  - `export function nextWatchAction(known: number | null, current: number | null, isDirty: boolean): WatchAction`
  - `export interface FileWatchDeps { path: string; known: number | null; currentPath: () => string | null; isDirty: () => boolean; modifiedAt: (path: string) => Promise<number | null>; confirmReload: () => Promise<boolean>; read: (path: string) => Promise<string>; }`
  - `export type FileWatchResult = { type: "none" } | { type: "keep"; known: number } | { type: "reload"; known: number; content: string }`
  - `export async function pollFileChange(deps: FileWatchDeps): Promise<FileWatchResult>`: 한 번의 폴링. `modifiedAt` 결과를 `nextWatchAction`에 넣고, `"ask"`면 `confirmReload`, 거절하면 `keep`. 읽은 뒤 `currentPath() !== path`이거나(`reload` 경로에서) `isDirty()`가 참이면 `none`을 돌려주고 기준값도 바꾸지 않는다. `read`가 던진 에러는 그대로 전파한다.
- Produces (TS, `src/lib/tauri.ts`):
  - `export function fileModifiedAt(path: string): Promise<number>`
  - `export function confirmReload(): Promise<boolean>`: `ask("디스크의 파일이 바뀌었습니다. 다시 불러오면 편집 중인 내용이 사라집니다.", { title: "mini-mark", kind: "warning", okLabel: "다시 불러오기", cancelLabel: "유지" })`
- Consumes: Task 1의 `openPath`.

- [ ] **Step 1: 실패하는 Rust 테스트 작성**

`fs.rs`의 `mod tests` 끝에 추가한다.

```rust
    #[test]
    fn file_modified_at_returns_mtime_millis() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.md");
        fs::write(&p, "x").unwrap();
        let f = fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_000_000)).unwrap();
        assert_eq!(file_modified_at(p.to_string_lossy().into()).unwrap(), 1_000_000_000);
    }

    #[test]
    fn file_modified_at_is_err_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(file_modified_at(dir.path().join("none.md").to_string_lossy().into()).is_err());
    }
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd src-tauri && cargo test`
Expected: 컴파일 에러. `file_modified_at`이 없음.

- [ ] **Step 3: `file_modified_at` 구현과 등록**

`fs::metadata(path)?.modified()?.duration_since(UNIX_EPOCH)?.as_millis() as u64`. 각 에러는 `map_err(|e| e.to_string())`. `lib.rs` `generate_handler!`에 추가.

- [ ] **Step 4: Rust 테스트**

Run: `cd src-tauri && cargo fmt && cargo clippy && cargo test`
Expected: 전체 PASS.

- [ ] **Step 5: 실패하는 Vitest 작성**

`src/lib/file-watch.test.ts`:

```ts
import { expect, it } from "vitest";
import { nextWatchAction } from "./file-watch";

it("does nothing without a baseline or when the file is missing", () => {
  expect(nextWatchAction(null, 10, false)).toBe("none");
  expect(nextWatchAction(10, null, false)).toBe("none");
});

it("does nothing when mtime is unchanged", () => {
  expect(nextWatchAction(10, 10, true)).toBe("none");
});

it("reloads silently when clean", () => {
  expect(nextWatchAction(10, 20, false)).toBe("reload");
});

it("asks when dirty", () => {
  expect(nextWatchAction(10, 20, true)).toBe("ask");
});

function deps(over: Partial<FileWatchDeps>): FileWatchDeps {
  return {
    path: "/a.md",
    known: 10,
    currentPath: () => "/a.md",
    isDirty: () => false,
    modifiedAt: async () => 20,
    confirmReload: async () => true,
    read: async () => "new",
    ...over,
  };
}

it("reloads with the new baseline when clean", async () => {
  await expect(pollFileChange(deps({}))).resolves.toEqual({ type: "reload", known: 20, content: "new" });
});

it("keeps the edit and advances the baseline when the user declines", async () => {
  const read = vi.fn(async () => "new");
  const result = await pollFileChange(deps({ isDirty: () => true, confirmReload: async () => false, read }));
  expect(result).toEqual({ type: "keep", known: 20 });
  expect(read).not.toHaveBeenCalled();
});

it("discards the read when the document changed meanwhile", async () => {
  let path = "/a.md";
  const read = async () => {
    path = "/b.md"; // 읽는 동안 다른 문서가 열렸다
    return "a-content";
  };
  await expect(pollFileChange(deps({ currentPath: () => path, read }))).resolves.toEqual({ type: "none" });
});

it("discards the read when the user typed meanwhile", async () => {
  let dirty = false;
  const read = async () => {
    dirty = true;
    return "new";
  };
  await expect(pollFileChange(deps({ isDirty: () => dirty, read }))).resolves.toEqual({ type: "none" });
});

it("propagates read errors without touching the baseline", async () => {
  await expect(pollFileChange(deps({ read: async () => { throw new Error("EACCES"); } }))).rejects.toThrow("EACCES");
});
```

import는 `import { expect, it, vi } from "vitest";`와 `import { nextWatchAction, pollFileChange, type FileWatchDeps } from "./file-watch";`.

- [ ] **Step 6: 테스트 실패 확인**

Run: `pnpm test src/lib/file-watch.test.ts`
Expected: FAIL. 모듈 없음.

- [ ] **Step 7: `nextWatchAction`과 `pollFileChange` 구현**

`src/lib/file-watch.ts`에 시그니처대로 구현한다. `pollFileChange`의 `"ask"` 경로는 사용자가 이미 버리기를 확인했으므로 읽은 뒤 `isDirty()`는 다시 보지 않고 `currentPath()`만 확인한다(대화상자가 모달이라 그 사이 입력은 없다). 파일 상단 주석: `// ponytail: 2초 mtime 폴링. 지연이 문제되면 notify 크레이트로 교체.`

- [ ] **Step 8: `tauri.ts` 래퍼와 `app.tsx` 폴링**

`app.tsx`:
- `const knownMtime = useRef<number | null>(null);`
- `openPath` 끝: `knownMtime.current = await fileModifiedAt(path).catch(() => null);`
- `saveDocument`: `saveMarkdownAtomic` 호출 전에 `knownMtime.current = null`, 성공 후 `knownMtime.current = await fileModifiedAt(path).catch(() => null)`. 실패 시 `catch` 블록에서도 다시 읽는다.
- `newDocument`: `knownMtime.current = null`.
- 마운트 이펙트에 `setInterval(() => void guarded(tick), 2000)` 등록, 정리에서 `clearInterval`. `guarded`가 `busy`를 잡으므로 틱 동안 메뉴와 Finder 열기는 무시되고, 반대로 문서 동작 중에는 틱이 건너뛴다. `tick`:

```ts
async function tick() {
  const path = filePathRef.current;
  const h = editor.current;
  if (path === null || h === null) return;
  const result = await pollFileChange({
    path,
    known: knownMtime.current,
    currentPath: () => filePathRef.current,
    isDirty: () => isDirtyRef.current,
    modifiedAt: (p) => fileModifiedAt(p).catch(() => null),
    confirmReload,
    read: readMarkdown,
  }).catch(async (err) => {
    // 실패를 소비하지 않으면 2초마다 같은 오류가 뜬다. 한 번 보이고 다음 외부 변경에서 다시 시도한다.
    await showError(String(err));
    const current = await fileModifiedAt(path).catch(() => null);
    return current === null ? { type: "none" as const } : { type: "keep" as const, known: current };
  });
  if (result.type === "none") return;
  knownMtime.current = result.known;
  if (result.type === "reload") {
    h.setValue(result.content);
    setIsDirty(false);
  }
}
```

`filePathRef`는 `isDirtyRef`와 같은 방식으로 추가한다. 다시 불러오면 커서가 문서 처음으로 간다(`setValue` 동작). 허용한다.

- [ ] **Step 9: 타입 체크와 테스트**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS.

- [ ] **Step 10: 수동 확인**

Run: `pnpm tauri dev`

1. 파일을 열고 터미널에서 `echo '## 외부 수정' >> <파일>` → 2초 안에 본문에 반영, 타이틀에 `•` 없음.
2. 본문에 글자를 입력(더티)한 뒤 다시 `echo` → "다시 불러오기/유지" 확인. 유지 → 편집 내용 유지, 다시 묻지 않음. `Cmd+S` → 디스크 내용이 편집 내용으로 덮인다.
3. 더티 상태에서 `echo` 후 다시 불러오기 → 디스크 내용으로 바뀌고 `•` 사라짐.
4. `Cmd+S`를 여러 번 눌러도 본문이 깜빡이거나 커서가 처음으로 가지 않는다.
5. 파일을 터미널에서 `rm` → 경고 없음. `Cmd+S` → 같은 경로에 다시 생성.
6. 한글 입력 중 2초 틱이 지나도 조합이 끊기지 않는다(변경이 없으면 틱은 `setValue`를 부르지 않는다).
7. 파일 권한을 `chmod 000`으로 막고 `touch` → 오류 대화상자가 한 번만 뜬다. `chmod 644` 후 다시 `touch` → 정상 리로드.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/fs.rs src-tauri/src/lib.rs src/lib/file-watch.ts src/lib/file-watch.test.ts src/lib/tauri.ts src/app.tsx
git commit -m "feat(app): 외부 파일 변경 감지와 다시 불러오기 추가"
```

---

### Task 3: File 메뉴와 최근 파일 목록

**Files:**
- Create: `src-tauri/src/recent.rs` (목록 로직, 영속화, 서브메뉴 갱신, 테스트)
- Create: `src-tauri/src/menu.rs` (메뉴 구성과 이벤트 처리를 `lib.rs`에서 이동)
- Modify: `src-tauri/src/lib.rs` (`mod recent; mod menu;`, `RecentFiles` manage, `add_recent_file` 등록)
- Modify: `src/lib/tauri.ts` (`DocumentAction` 타입, `addRecentFile`, `onDocumentAction`)
- Modify: `src/app.tsx` (keydown 제거, `onDocumentAction` 연결, `openPath`/`saveDocument`에서 `addRecentFile`)
- Delete: `src/lib/document-shortcuts.ts`, `src/lib/document-shortcuts.test.ts`

**Interfaces:**
- Produces (Rust, `recent.rs`):
  - `pub const MAX_RECENT: usize = 10;`
  - `pub fn push_recent(list: &mut Vec<String>, path: &str)`: 같은 경로 제거 후 맨 앞에 삽입, `MAX_RECENT`로 자른다.
  - `pub fn load(path: &Path) -> Vec<String>`: 없거나 파싱 실패면 빈 벡터.
  - `pub fn store(path: &Path, list: &[String]) -> Result<(), String>`: 부모 폴더 생성 후 JSON 배열로 기록.
  - `pub struct RecentFiles { pub list: Mutex<Vec<String>>, pub menu: Submenu<Wry>, pub store_path: PathBuf }`
  - `pub fn rebuild_menu(menu: &Submenu<Wry>, app: &AppHandle, list: &[String]) -> tauri::Result<()>`: 항목을 모두 지우고 `recent:<i>`(텍스트는 파일명) 항목들, separator, `clear-recent`("Clear Menu", 목록이 비면 비활성) 순으로 다시 넣는다.
  - `#[tauri::command] pub fn add_recent_file(app: AppHandle, state: State<RecentFiles>, path: String) -> Result<(), String>`: `push_recent`, `store`, `rebuild_menu`.
- Produces (Rust, `menu.rs`):
  - `pub fn build(app: &AppHandle) -> tauri::Result<(Menu<Wry>, Submenu<Wry>)>`: 기존 app/Edit/Window 메뉴에 File 메뉴를 추가하고 Open Recent 서브메뉴 핸들을 함께 반환.
  - `pub fn on_event(app: &AppHandle, event: MenuEvent)`: `quit`은 기존 창 닫기 우회, `new`/`open`/`save`/`saveAs`는 `app.emit("document-action", id)`, `recent:<i>`는 목록에서 경로를 찾아 `app.emit("open-file", path)`, `clear-recent`는 목록 비우고 `store`와 `rebuild_menu`.
- Produces (TS, `src/lib/tauri.ts`):
  - `export type DocumentAction = "new" | "open" | "save" | "saveAs";`
  - `export function addRecentFile(path: string): Promise<void>`
  - `export function onDocumentAction(handler: (action: DocumentAction) => void): Promise<() => void>` (`listen<DocumentAction>("document-action", ...)`)
- Consumes: Task 1의 `openPath`, `open-file` 리스너(최근 항목 선택도 같은 경로로 열린다).

- [ ] **Step 1: 실패하는 Rust 테스트 작성**

`src-tauri/src/recent.rs`를 만들고 테스트부터 적는다.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_recent_moves_duplicate_to_front() {
        let mut list = vec!["/a.md".to_string(), "/b.md".to_string()];
        push_recent(&mut list, "/b.md");
        assert_eq!(list, vec!["/b.md", "/a.md"]);
    }

    #[test]
    fn push_recent_keeps_at_most_ten() {
        let mut list: Vec<String> = (0..10).map(|i| format!("/{i}.md")).collect();
        push_recent(&mut list, "/new.md");
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0], "/new.md");
        assert!(!list.contains(&"/9.md".to_string()));
    }

    #[test]
    fn store_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nested").join("recent-files.json");
        store(&p, &["/a.md".to_string()]).unwrap();
        assert_eq!(load(&p), vec!["/a.md"]);
    }

    #[test]
    fn load_returns_empty_when_missing_or_invalid() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(&dir.path().join("none.json")).is_empty());
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "{not json").unwrap();
        assert!(load(&bad).is_empty());
    }
}
```

- [ ] **Step 2: 테스트 실패 확인**

`lib.rs`에 `mod recent;`를 추가한 뒤 실행한다.

Run: `cd src-tauri && cargo test`
Expected: 컴파일 에러. `push_recent`, `load`, `store`, `MAX_RECENT`가 없음.

- [ ] **Step 3: `recent.rs` 구현**

인터페이스대로 구현한다. `rebuild_menu`는 `while menu.remove_at(0)?.is_some() {}`로 비운 뒤 `MenuItemBuilder::with_id(format!("recent:{i}"), file_name)`로 항목을 만들고 `PredefinedMenuItem::separator`, `MenuItemBuilder::with_id("clear-recent", "Clear Menu").enabled(!list.is_empty())` 순으로 `append`한다. 파일명은 `Path::new(p).file_name()`이 없으면 경로 전체. `ponytail:` 주석: 같은 이름의 파일은 구분되지 않는다. 필요하면 상위 폴더명을 붙인다. 목록에 있는 파일이 사라져도 지우지 않는다. 열기 실패는 기존 에러 대화상자로 보인다.

- [ ] **Step 4: Rust 테스트**

Run: `cd src-tauri && cargo fmt && cargo clippy && cargo test`
Expected: 전체 PASS.

- [ ] **Step 5: `menu.rs`로 메뉴 이동과 File 메뉴 추가**

`lib.rs`의 `setup` 안 메뉴 구성과 `on_menu_event` 본문을 `menu.rs`로 옮긴다. File 메뉴:

```rust
let new = MenuItemBuilder::with_id("new", "New").accelerator("CmdOrCtrl+N").build(app)?;
let open = MenuItemBuilder::with_id("open", "Open...").accelerator("CmdOrCtrl+O").build(app)?;
let open_recent = SubmenuBuilder::with_id(app, "open-recent", "Open Recent").build()?;
let save = MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?;
let save_as = MenuItemBuilder::with_id("saveAs", "Save As...").accelerator("CmdOrCtrl+Shift+S").build(app)?;
let file_menu = SubmenuBuilder::new(app, "File")
    .item(&new).item(&open).item(&open_recent).separator().item(&save).item(&save_as)
    .build()?;
```

순서는 app, File, Edit, Window. `lib.rs` `setup`:

```rust
let (menu, open_recent) = menu::build(app.handle())?;
app.set_menu(menu)?;
let store_path = app.path().app_data_dir()?.join("recent-files.json");
let list = recent::load(&store_path);
recent::rebuild_menu(&open_recent, app.handle(), &list)?;
app.manage(recent::RecentFiles { list: Mutex::new(list), menu: open_recent, store_path });
```

`.on_menu_event(menu::on_event)`, `generate_handler!`에 `recent::add_recent_file` 추가.

- [ ] **Step 6: 빌드 확인**

Run: `cd src-tauri && cargo fmt && cargo clippy && cargo test`
Expected: 경고 없음.

- [ ] **Step 7: 프론트엔드 연결과 keydown 제거**

- `src/lib/tauri.ts`에 `DocumentAction`, `addRecentFile`, `onDocumentAction` 추가.
- `src/app.tsx`: `matchShortcut` import와 `window.addEventListener("keydown", ...)` 제거. 마운트 이펙트에 `onDocumentAction((a) => void guarded(() => actions.current[a]()))` 등록, 정리에서 unlisten. `guarded`는 이 진입점에서만 부르고 `actions` 안의 `openDocument`, `openPath`, `saveDocument`는 가드 없이 그대로 둔다. `openPath` 성공 끝과 `saveDocument` 성공 끝에 `await addRecentFile(path)`.
- `src/lib/document-shortcuts.ts`, `src/lib/document-shortcuts.test.ts` 삭제(`git rm`).

- [ ] **Step 8: 타입 체크와 테스트**

Run: `pnpm tsc --noEmit && pnpm test`
Expected: 전체 PASS. `document-shortcuts` 참조가 남아 있지 않다.

- [ ] **Step 9: 수동 확인**

Run: `pnpm tauri dev`

1. 메뉴 막대에 File 메뉴가 보이고 각 항목 옆에 단축키가 표시된다.
2. `Cmd+S`(미저장 문서) → 저장 대화상자가 한 번만 뜬다. 취소 후 `Cmd+N`, `Cmd+O`, `Cmd+Shift+S` 각각 한 번씩만 동작한다. 두 번 뜨거나 전혀 반응하지 않으면 중단하고 보고한다(메뉴 accelerator와 웹뷰 키 이벤트 순서 문제).
3. 에디터 안에서 `Cmd+Z`, `Cmd+C`, `Cmd+V`가 여전히 동작한다.
4. 파일 두 개를 열고 File > Open Recent → 최근 연 파일이 위에, 아래에 Clear Menu. 항목 클릭 → 열린다. 더티 상태면 버리기 확인.
5. 앱 재시작 → 목록 유지. `~/Library/Application Support/com.kimjonghan.mini-mark/recent-files.json`에 배열이 있다.
6. Clear Menu → 목록이 비고 Clear Menu가 비활성화된다.
7. 11개 파일을 차례로 열기 → 10개만 남는다.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/recent.rs src-tauri/src/menu.rs src-tauri/src/lib.rs src/lib/tauri.ts src/app.tsx
git rm src/lib/document-shortcuts.ts src/lib/document-shortcuts.test.ts
git commit -m "feat(app): File 메뉴와 최근 파일 목록 추가"
```

---

### Task 4: 성능 프로파일링

**Files:**
- Modify: `docs/PLAN.md` (4단계 아래 "측정 결과 (4단계)" 절 추가)
- Modify(측정 결과에 따라서만): `src/markdown-editor.ts`

**Interfaces:**
- Consumes: Task 5 전에 릴리스 번들이 필요하므로 이 태스크에서 `pnpm tauri build`를 먼저 한 번 실행한다. 번들 산출물 검증은 Task 5가 맡는다.

- [ ] **Step 1: 대용량 문서 생성**

```bash
{
  for i in $(seq 1 3000); do
    printf '## 절 %d\n\n한글 본문 문단입니다. 마크다운 에디터의 타이핑 지연을 확인하기 위한 문장을 반복합니다. %d\n\n- 항목 하나\n- 항목 둘 **굵게** `코드`\n\n```ts\nconst v%d = %d;\n```\n\n' "$i" "$i" "$i" "$i"
  done
} > /tmp/mini-mark-large.md
ls -lh /tmp/mini-mark-large.md
```

Expected: 약 600KB 이상. 2MB에 못 미치면 `seq` 상한을 10000으로 올린다.

- [ ] **Step 2: 릴리스 빌드와 번들 크기**

Run: `pnpm tauri build`
Expected: `src-tauri/target/release/bundle/macos/mini-mark.app`, `src-tauri/target/release/bundle/dmg/mini-mark_0.1.0_aarch64.dmg` 생성. `pnpm build` 출력의 JS 청크 크기와 `du -sh` 결과를 기록한다.

```bash
du -sh src-tauri/target/release/bundle/macos/mini-mark.app src-tauri/target/release/bundle/dmg/*.dmg
```

- [ ] **Step 3: 콜드 스타트 측정**

```bash
APP=src-tauri/target/release/bundle/macos/mini-mark.app
pkill -x mini-mark; sleep 1
start=$(python3 -c 'import time;print(time.time())')
open -a "$APP"
until osascript -e 'tell application "System Events" to count windows of process "mini-mark"' 2>/dev/null | grep -q '^[1-9]'; do :; done
python3 -c "import time;print(f'{time.time()-$start:.2f}s')"
```

3회 반복해 중앙값을 기록한다. 창 생성 시점까지의 값이므로 본문 표시까지는 눈으로 확인한다. 목표 1초 이내.

- [ ] **Step 4: 유휴 메모리 측정**

앱을 띄우고 `/tmp/mini-mark-large.md`를 연 뒤 30초 대기. Activity Monitor > 메모리 탭에서 `mini-mark`와 `mini-mark Web Content`(이름이 다르면 `com.apple.WebKit.WebContent` 중 mini-mark 하위) 합계를 기록한다. 빈 문서 상태도 같이 기록한다. 목표 100MB 이내.

- [ ] **Step 5: 타이핑 지연 측정**

`pnpm tauri build --debug`로 만든 디버그 번들을 띄우고 큰 문서를 연다. Safari > 개발자용 > (Mac 이름) > mini-mark로 Web Inspector를 연 뒤 타임라인 녹화를 시작하고 문서 중간에 한글 한 문장을 입력한다. 키 입력당 스크립트 + 레이아웃 시간의 최대값을 기록한다. 목표 100ms 이내.

지연이 크면 타임라인에서 가장 긴 호출 스택 상위 1개만 기록한다. Prism 데코레이션이 범인이면 `@milkdown/plugin-prism` 설정으로 코드 블록이 바뀐 트랜잭션에서만 다시 계산하는지 확인하고, 아니면 알려진 문제로 남긴다. 측정 없이 코드를 바꾸지 않는다.

- [ ] **Step 6: 결과 기록**

`docs/PLAN.md` 4단계 아래에 추가한다.

```markdown
- 측정 결과 (4단계, Apple Silicon, 릴리스 빌드)
  - 번들: `.app` <N>MB, `.dmg` <N>MB (목표 10MB 이하)
  - 콜드 스타트: <N>초 (창 생성 기준, 3회 중앙값)
  - 유휴 메모리: 빈 문서 <N>MB, 대용량 문서 <N>MB (목표 100MB 이내)
  - 타이핑 지연: <N>ms (대용량 문서, 키 입력당 최대)
```

목표 미달 항목은 "알려진 문제 (4단계)"에 원인 추정과 함께 적는다.

- [ ] **Step 7: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs(plan): 4단계 성능 측정 결과 기록"
```

측정 결과로 `src/markdown-editor.ts`를 고쳤다면 별도 커밋 `fix(editor): ...`로 먼저 넣는다.

---

### Task 5: 프로덕션 번들 검증과 계획 마감

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle.category`, `bundle.macOS.minimumSystemVersion`)
- Modify: `src-tauri/Cargo.toml` (`description`, `authors`)
- Modify: `docs/PLAN.md` (4단계 체크박스, 알려진 문제)

**Interfaces:**
- Consumes: Task 4가 만든 릴리스 번들. 설정을 바꾸므로 다시 빌드한다.

- [ ] **Step 1: 번들 메타데이터 정리**

`tauri.conf.json` `bundle`에 `"category": "Productivity"`, `"macOS": { "minimumSystemVersion": "12.0" }` 추가. `Cargo.toml` `description = "macOS 경량 마크다운 에디터"`, `authors = ["jong-k"]`.

- [ ] **Step 2: 릴리스 빌드**

Run: `pnpm tauri build`
Expected: 에러 없음. `.app`과 `.dmg` 생성.

- [ ] **Step 3: 번들 검증**

```bash
APP=src-tauri/target/release/bundle/macos/mini-mark.app
plutil -p "$APP/Contents/Info.plist" | grep -E 'CFBundleDocumentTypes|LSItemContentTypes|public.markdown|md|LSMinimumSystemVersion|LSApplicationCategoryType'
codesign -dv "$APP" 2>&1 | head -3
```

Expected: Info.plist에 `md`, `markdown` 확장자가 든 `CFBundleDocumentTypes`, `LSMinimumSystemVersion 12.0`, 카테고리가 보인다. `codesign`은 ad-hoc 서명(`Signature=adhoc`)이거나 서명 없음.

1. `.dmg`를 더블클릭 → 마운트되고 Applications 바로가기가 보인다. `.app`을 `/Applications`로 복사.
2. `/Applications/mini-mark.app` 실행 → 열린다(같은 머신에서 빌드했으므로 격리 속성 없음). 다른 머신으로 옮길 때는 `xattr -d com.apple.quarantine /Applications/mini-mark.app`가 필요하다.
3. Finder에서 `.md` 더블클릭 → `/Applications`의 앱으로 열린다(Task 1 재확인).
4. 1~3단계 핵심 동작 재확인: 열기, 편집, 저장, 이미지 붙여넣기, 다크 모드, 외부 변경 감지, Open Recent.

- [ ] **Step 4: `docs/PLAN.md` 마감**

- 4단계 다섯 항목을 `[x]`로 바꾼다. "최근 열었던 파일(Recent Files) 목록 관리" 항목 끝에 "(File 메뉴 추가, 단축키는 메뉴 accelerator로 이동)"을 덧붙인다.
- "알려진 문제 (4단계)" 절을 추가한다.

```markdown
- 알려진 문제 (4단계)
  - 코드 서명과 공증 없음. 다른 머신에서는 `xattr -d com.apple.quarantine`가 필요하다
  - 여러 파일을 동시에 열면 첫 파일만 연다(단일 창)
  - 외부 변경은 2초 폴링으로 감지한다. 다시 불러오면 커서가 문서 처음으로 간다
  - Open Recent는 파일명만 표시해 같은 이름의 파일을 구분하지 못한다. 사라진 파일은 목록에서 자동으로 빠지지 않는다
  - 창에 `.md` 파일을 드롭해도 열리지 않음(3단계와 동일, Dock 아이콘 드롭은 동작)
```

Task 4에서 목표 미달로 적은 항목이 있으면 유지한다.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock docs/PLAN.md
git commit -m "chore(tauri): 프로덕션 번들 메타데이터 정리와 4단계 완료 표시"
```
