# 다중 창 구현 계획

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: Typora처럼 창을 여러 개 열고, Cmd+N으로 빈 창을, 파일 열기는 빈 창이나 새 창에서 열며, 마지막 창을 닫아도 앱이 남게 한다.

Architecture: 창 라우팅, 창 생성, 열기 대화상자, 종료는 Rust `src-tauri/src/windows.rs`가 맡는다. `Windows` 구조체가 창 라벨별 문서 상태(`path`, `dirty`)와 보류 경로를 들고, 순수 함수 `route_open`이 어느 창에서 열지 정한다. 각 창의 JS는 `filePath`와 `isDirty`가 바뀔 때 `set_document_state`로 보고하고, 자기 창을 겨냥한 이벤트만 `getCurrentWebviewWindow().listen()`으로 받는다. Rust는 `emit_to(label)`로 앞 창에만 보낸다. `App`의 `newDocument`, `openDocument`와 `tauri.ts`의 `pickOpenPath`는 지운다.

Tech Stack: Tauri v2 (`WebviewWindowBuilder::from_config`, `Emitter::emit_to`, `RunEvent::{Opened, Reopen, ExitRequested, WindowEvent}`, `Submenu::set_as_windows_menu_for_nsapp`), tauri-plugin-dialog(Rust `DialogExt`), `@tauri-apps/api/webviewWindow`, React 19, Vitest

Spec: `docs/spec/windows.md`

## Global Constraints

- 의존성을 추가하지 않는다. `tauri-plugin-dialog`는 이미 있다.
- `App`은 React 상태를 갖지 않는다. 문서 메타데이터는 `doc` ref 하나에 두고, 바뀌면 창 제목과 Rust 보고만 한다.
- Tauri 호출은 `src/lib/tauri.ts` 래퍼를 거친다. 컴포넌트에서 `invoke`를 직접 부르지 않는다.
- JS 이벤트 리스너는 `getCurrentWebviewWindow().listen()`만 쓴다. 전역 `listen()`은 모든 창이 받으므로 쓰지 않는다. Rust는 앞 창을 겨냥할 때 `emit_to(label, ...)`를 쓴다.
- 창 라벨은 `main`, 그 뒤 `win-1`, `win-2`처럼 늘기만 한다. 새 창 위치는 앞 창 기준 `+24.0, +24.0`(논리 좌표)이다.
- 빈 창은 `path == None && !dirty`다.
- Rust 커맨드 에러는 `Result<T, String>`이다. 가운뎃점 문자를 쓰지 않는다. 커밋 메시지는 `docs/conventions/commit-convention.md`를 따르고 본문 없이 Co-Authored-By 꼬리말만 붙인다.
- 커밋 전 `pnpm lint`, `pnpm fmt:check`, `pnpm test`를 통과시킨다. Rust를 바꾼 커밋은 `pnpm fmt:rs`, `pnpm lint:rs`, `cargo test --manifest-path src-tauri/Cargo.toml`도 통과시킨다.

## Review Focus

- 앱이 꺼진 상태에서 Finder로 파일 두 개를 열면 창이 정확히 두 개 생기고 빈 창이 남지 않아야 한다. `main`이 준비되기 전 첫 경로는 `main`에 보류하고 둘째 경로는 새 창을 만든다(Task 2 테스트 `cold_start_with_two_files_uses_main_then_new_window`).
- 시작 직후 빈 창에서 Cmd+O로 열면 새 창이 아니라 그 창에서 열려야 한다(Task 2 테스트 `focused_blank_window_is_reused`).
- 이미 연 파일을 다시 열면 두 번째 창이 아니라 기존 창이 앞으로 와야 한다(Task 2 테스트 `already_open_path_focuses_that_window`).
- 수정한 창이 있을 때 Cmd+Q를 취소하면 앱이 남고, 그 뒤 마지막 창을 닫아도 종료되면 안 된다. JS가 닫기를 취소할 때 `cancel_quit`를 불러 `quitting`을 내린다(Task 5 수동 검증 항목).
- 창 두 개가 모두 수정됐을 때 Cmd+S는 앞 창만 저장해야 한다. `emit_to`와 창별 `listen`의 짝이 어긋나면 두 창이 모두 저장된다(Task 4 수동 검증).

---

### Task 1: 스펙 문서

Files:

- Create: `docs/spec/windows.md`

- [ ] Step 1: 브레인스토밍에서 확정한 스펙을 `docs/spec/windows.md`에 쓴다(계획 승인 시 함께 전달된 내용 그대로). 상태는 "계획"이다.

- [ ] Step 2: 포맷 확인과 커밋

Run: `pnpm fmt:check`

```bash
git add docs/spec/windows.md
git commit -m "docs(spec): 다중 창 스펙 추가"
```

---

### Task 2: 창 상태와 열기 라우팅 순수 로직

Files:

- Create: `src-tauri/src/windows.rs` (순수 부분만. Tauri 연동은 Task 3)
- Modify: `src-tauri/src/lib.rs` (`mod windows;` 추가, `OpenedFile`과 그 테스트 삭제, `take_opened_file` 삭제)

Interfaces:

- Produces:

```rust
// src-tauri/src/windows.rs
pub const MAIN: &str = "main";

/// JS가 보고한 창의 문서 상태. `take`로 준비된 창만 항목이 있다.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Doc { pub path: Option<String>, pub dirty: bool }

/// 라우팅 입력. 지금 떠 있는 창과 포커스 여부.
pub struct Existing<'a> { pub label: &'a str, pub focused: bool }

#[derive(Debug, PartialEq)]
pub enum Route {
    /// 이미 연 창을 앞으로
    Focus(String),
    /// 준비 전인 창에 보류했다. 창이 `take`하면 연다
    Pending(String),
    /// 빈 창에 open-file 이벤트를 보낸다
    Emit(String),
    /// 이 라벨로 새 창을 만든다. 경로는 보류해 두었다
    Create(String),
}

#[derive(Default)]
pub struct Windows {
    next_id: u32,
    docs: HashMap<String, Doc>,
    pending: HashMap<String, String>,
    pub quitting: bool,
}

impl Windows {
    pub fn route_open(&mut self, path: &str, existing: &[Existing]) -> Route;
    /// 창을 준비 상태로 표시하고 보류 경로를 한 번 돌려준다.
    pub fn take(&mut self, label: &str) -> Option<String>;
    pub fn set_doc(&mut self, label: &str, doc: Doc);
    /// "win-1", "win-2", ... 번호는 늘기만 한다.
    pub fn new_label(&mut self) -> String;
    /// 창이 사라지면 상태와 보류 경로를 지운다.
    pub fn forget(&mut self, label: &str);
}
```

- [ ] Step 1: 실패하는 테스트 작성(`windows.rs` 안 `#[cfg(test)] mod tests`)

```rust
fn win<'a>(label: &'a str, focused: bool) -> Existing<'a>

#[test] fn cold_start_stores_path_for_unready_main()
// Windows::default(), existing [main 비포커스], route_open("/a.md") == Pending("main"), take("main") == Some("/a.md"), take("main") == None
#[test] fn cold_start_with_two_files_uses_main_then_new_window()
// 첫 경로 Pending("main"), 둘째 경로 Create("win-1"), take("win-1") == Some("/b.md")
#[test] fn already_open_path_focuses_that_window()
// take("main") 뒤 set_doc("main", {path: Some("/a.md"), dirty: true}), route_open("/a.md") == Focus("main")
#[test] fn focused_blank_window_is_reused()
// take("main") 뒤(보고 없음, Doc::default()), existing [main 포커스], route_open("/a.md") == Emit("main")
#[test] fn unfocused_blank_window_is_reused_when_front_is_not_blank()
// main은 dirty, win-1은 blank(take만), existing [main 포커스, win-1 비포커스] → Emit("win-1")
#[test] fn no_blank_window_creates_new_one_with_pending_path()
// main dirty, route_open("/b.md") == Create("win-1"), 다시 route_open("/c.md") == Create("win-2"), take("win-2") == Some("/c.md")
#[test] fn pending_window_is_not_reused_for_a_second_path()
// Create("win-1") 뒤 take 전에 route_open("/d.md")는 win-1을 쓰지 않고 Create("win-2")
#[test] fn forget_removes_doc_and_pending()
// Create("win-1") 뒤 forget("win-1"), take("win-1") == None, set_doc한 main을 forget하면 route_open("/a.md")가 Focus가 아니다
#[test] fn new_label_never_repeats()
// new_label() == "win-1", forget 뒤에도 다음은 "win-2"
```

- [ ] Step 2: 실패 확인

Run: `cargo test --manifest-path src-tauri/Cargo.toml windows`
Expected: FAIL, 모듈 없음

- [ ] Step 3: `windows.rs` 순수 부분 구현

`route_open` 순서: (1) `docs`에서 `path == Some(path)`인 라벨 → `Focus`. (2) `existing` 중 `docs`에도 `pending`에도 없는 라벨(준비 전) → `pending.insert` 뒤 `Pending`. (3) `existing` 중 포커스된 창이 빈 창(`docs.get(label) == Some(Doc{path: None, dirty: false})`)이면, 아니면 빈 창 아무거나 → `Emit`. (4) `new_label()`로 라벨을 만들고 `pending.insert` 뒤 `Create`. `take`는 `docs.entry(label).or_default()` 뒤 `pending.remove(label)`.

`lib.rs`에서 `OpenedFile`, `first_file_path`, `take_opened_file`, 테스트 모듈을 지우고 `mod windows;`를 더한다. 빌드가 깨지지 않게 `invoke_handler`의 `take_opened_file`은 Task 3까지 `windows::take_opened_file`로 미리 옮기지 말고 이 커밋에서는 `.run` 안의 `Opened` 처리와 함께 잠시 제거한다(Task 3에서 복구). 이 커밋 사이에는 Finder 열기가 동작하지 않는다.

- [ ] Step 4: 통과 확인

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, `recent` 테스트 포함

- [ ] Step 5: 포맷, 린트, 커밋

Run: `pnpm fmt:rs && pnpm lint:rs`

```bash
git add src-tauri/src/windows.rs src-tauri/src/lib.rs
git commit -m "feat(windows): 창별 문서 상태와 열기 라우팅 추가"
```

---

### Task 3: Tauri 연동(창 생성, 열기, 종료, 메뉴 라우팅)

Files:

- Modify: `src-tauri/src/windows.rs` (앱 연동 함수와 커맨드)
- Modify: `src-tauri/src/lib.rs` (`manage`, `invoke_handler`, `.run` 이벤트)
- Modify: `src-tauri/src/menu.rs` (`on_event` 라우팅, Window 메뉴)
- Modify: `src-tauri/src/recent.rs` 는 바꾸지 않는다. `menu.rs`의 `recent:` 분기만 `windows::open_file`로 바꾼다.
- Modify: `src-tauri/capabilities/default.json` (`"windows": ["main", "win-*"]`)

Interfaces:

- Consumes: Task 2의 `Windows`, `Route`, `Existing`, `Doc`
- Produces:

```rust
// src-tauri/src/windows.rs
pub fn open_file(app: &AppHandle, path: String);        // route_open 결과를 실행한다
pub fn open_blank(app: &AppHandle);                      // Cmd+N, Dock 재열기
pub fn pick_and_open(app: &AppHandle);                   // Cmd+O. 대화상자 뒤 open_file
pub fn quit(app: &AppHandle);                            // Cmd+Q
pub fn focused_label(app: &AppHandle) -> Option<String>; // menu.rs가 쓴다
pub fn on_run_event(app: &AppHandle, event: RunEvent);   // Opened, Reopen, ExitRequested, WindowEvent::Destroyed

#[tauri::command] pub fn take_opened_file(window: WebviewWindow, state: State<Mutex<Windows>>) -> Option<String>;
#[tauri::command] pub fn set_document_state(window: WebviewWindow, state: State<Mutex<Windows>>, path: Option<String>, dirty: bool);
#[tauri::command] pub fn cancel_quit(state: State<Mutex<Windows>>);
```

JS가 받는 이벤트(모두 `emit_to(label, ...)`): `open-file`(String), `document-action`("save" | "saveAs"), `find-action`("find" | "findNext" | "findPrev").

- [ ] Step 1: `windows.rs` 앱 연동 구현

- `existing(app) -> Vec<(String, bool)>`: `app.webview_windows()`를 돌며 `(label, is_focused().unwrap_or(false))`. `route_open`에 넘길 때 `Existing { label: &l, focused: f }`로 빌린다. `focused_label`은 그중 포커스된 첫 라벨.
- `create_window(app, label) -> tauri::Result<WebviewWindow>`: `let mut cfg = app.config().app.windows[0].clone(); cfg.label = label.into();` `WebviewWindowBuilder::from_config(app, &cfg)?`. 앞 창이 있으면 `outer_position()?.to_logical::<f64>(scale_factor()?)`에 `+24.0`씩 더해 `.position(x, y)`. `.build()`.
- `open_file`: `state.lock()`으로 `route_open(&path, &existing)`를 받고 잠금을 푼 뒤 실행. `Focus` → `get_webview_window(label)`의 `set_focus()`. `Pending` → 없음. `Emit` → `app.emit_to(label, "open-file", path)`. `Create` → `create_window`. 실패는 `eprintln!`로만 남긴다(창 생성 실패를 보여 줄 창이 없을 수 있다).
- `open_blank`: `new_label()` 뒤 `create_window`.
- `pick_and_open`: `use tauri_plugin_dialog::DialogExt;` `app.dialog().file().add_filter("Markdown", &["md", "markdown"]).pick_file(move |p| ...)`. `p.and_then(|f| f.into_path().ok())`가 있으면 `open_file(&app, path.to_string_lossy().into_owned())`.
- `quit`: `quitting = true`. `webview_windows()`가 비어 있으면 `app.exit(0)`, 아니면 모두 `close()`. JS 가드가 막으면 창이 남고 JS가 `cancel_quit`를 부른다.
- `on_run_event`: `Opened { urls }` → `file` 스킴 URL마다 `to_file_path()`로 바꿔 `open_file`. `Reopen { has_visible_windows: false, .. }` → `open_blank`. `ExitRequested { code: None, api, .. }` → `api.prevent_exit()`. `WindowEvent { label, event: WindowEvent::Destroyed }` → `forget(label)` 뒤 `quitting`이고 `webview_windows().keys().all(|l| *l == label)`이면 `app.exit(0)`.
- 커맨드: `take_opened_file`은 `state.lock().take(window.label())`. `set_document_state`는 `set_doc(window.label(), Doc { path, dirty })`. `cancel_quit`는 `quitting = false`.

- [ ] Step 2: `lib.rs` 연결

`.manage(Mutex::new(windows::Windows::default()))`, `invoke_handler`에 `windows::take_opened_file, windows::set_document_state, windows::cancel_quit`. `.run(|app, event| windows::on_run_event(app, event))`. 기존 ponytail 주석(여러 파일 첫 파일만)을 지운다.

- [ ] Step 3: `menu.rs` 라우팅

`on_event`: `"quit"` → `windows::quit(app)`. `"new"` → `windows::open_blank(app)`. `"open"` → `windows::pick_and_open(app)`. `"save" | "saveAs"`와 `"find" | "findNext" | "findPrev"` → `if let Some(label) = windows::focused_label(app) { let _ = app.emit_to(label, "document-action" 또는 "find-action", id); }`. `recent:` 분기 → `windows::open_file(app, path)`. `build`에서 `window_menu.set_as_windows_menu_for_nsapp()?;`를 `MenuBuilder` 전에 부른다. "단축키는 메뉴 accelerator가 맡는다" 주석에 "앞 창에만 보낸다"를 덧붙인다.

- [ ] Step 4: `capabilities/default.json`의 `"windows"`를 `["main", "win-*"]`로, description을 "Capability for every document window"로 바꾼다.

- [ ] Step 5: 빌드, 포맷, 린트, 테스트

Run: `pnpm fmt:rs && pnpm lint:rs && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 경고 없음, PASS

- [ ] Step 6: 커밋

```bash
git add src-tauri/src/windows.rs src-tauri/src/lib.rs src-tauri/src/menu.rs src-tauri/capabilities/default.json
git commit -m "feat(windows): 새 창 생성, 열기 라우팅, 종료 처리를 Rust로 이동"
```

---

### Task 4: 프론트엔드를 창별 이벤트로 전환

Files:

- Modify: `src/lib/tauri.ts`
- Modify: `src/app.tsx`

Interfaces:

- Consumes: Task 3의 커맨드와 이벤트
- Produces:

```ts
// src/lib/tauri.ts
/** File 메뉴 항목 id와 같다. Rust `menu.rs`가 앞 창에만 emit_to한다. New와 Open은 Rust가 처리한다. */
export type DocumentAction = "save" | "saveAs";
/** 이 창의 문서 상태를 Rust에 보고한다. 빈 창 판단과 같은 파일 재열기에 쓴다. */
export function reportDocumentState(path: string | null, dirty: boolean): Promise<void>; // invoke("set_document_state", { path, dirty })
/** 닫기 확인을 취소했을 때 부른다. Cmd+Q 진행 중이면 종료를 멈춘다. */
export function cancelQuit(): Promise<void>; // invoke("cancel_quit")
```

- [ ] Step 1: `tauri.ts` 수정

- `import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"`로 바꾸고 `getCurrentWindow`와 `listen` import를 지운다. `onOpenFileRequested`, `onDocumentAction`, `onFindAction`은 `getCurrentWebviewWindow().listen<T>(event, ...)`로, `setWindowTitle`과 `onWindowCloseRequested`는 `getCurrentWebviewWindow()`로 바꾼다. 주석: "전역 listen은 모든 창이 받는다. 이 창을 겨냥한 emit_to만 받는다."
- `pickOpenPath`와 `open` import를 지운다. `DocumentAction`을 좁힌다. `reportDocumentState`, `cancelQuit`를 더한다. `takeOpenedFile` 주석을 "이 창에 보류된 경로. 콜드 스타트의 Finder 인자나 새 창에 열 파일이다"로 바꾼다.

- [ ] Step 2: `app.tsx` 수정

- `newDocument`, `openDocument`를 지우고 `actions = { save, saveAs }`. import에서 `pickOpenPath`를 빼고 `reportDocumentState`, `cancelQuit`를 더한다.
- `update(patch)`: 제목 갱신 뒤 `filePath`나 `isDirty`가 바뀌었으면 `void reportDocumentState(doc.current.filePath, doc.current.isDirty)`. 실패는 무시한다(보고는 부가 기능이다).
- 닫기 가드: `onWindowCloseRequested(async () => { if (!doc.current.isDirty || (await confirmDiscard())) return true; await cancelQuit().catch(() => {}); return false; })`.
- 큐 주석의 "Cmd+N/Cmd+O"를 "Finder 열기나 Open Recent"로 고친다. 단축키 주석을 "Save, Save As는 메뉴가 앞 창에만 보낸다. New와 Open은 Rust가 처리한다"로 고친다.

- [ ] Step 3: 타입, 린트, 포맷, 테스트, 빌드

Run: `pnpm lint && pnpm fmt:check && pnpm test && pnpm build`
Expected: 모두 PASS. `tsc`가 `pickOpenPath`나 `"new"` 참조 잔재를 잡는다.

- [ ] Step 4: 커밋

```bash
git add src/lib/tauri.ts src/app.tsx
git commit -m "feat(windows): 프론트엔드를 창별 이벤트와 문서 상태 보고로 전환"
```

---

### Task 5: 수동 검증과 문서 갱신

Files:

- Modify: `docs/spec/windows.md` ("확인 필요" 체크, 상태 줄)
- Modify: `docs/PLAN.md` (4단계 알려진 문제의 "여러 파일을 동시에 열면 첫 파일만 연다(단일 창)" 줄을 지우고, 4단계 목록 끝에 "- [x] 다중 창(Cmd+N 새 창, 파일별 창, 마지막 창 닫아도 앱 유지). 스펙은 `spec/windows.md`"를 더한다)

- [ ] Step 1: 실제 앱에서 수동 검증

Run: `pnpm tauri dev`

`docs/spec/windows.md`의 "확인 필요" 12항목을 하나씩 확인해 체크한다. 실패한 항목은 고친 뒤 다시 확인한다. 상태 줄을 "구현 완료, 실제 앱 수동 검증 완료(날짜)"로 바꾼다.

- [ ] Step 2: 릴리스 빌드 확인

Run: `pnpm tauri build`
Expected: 빌드 성공. 빌드된 `.app`을 Finder에서 열고 파일 두 개 더블클릭으로 창 두 개가 뜨는지 본다(dev 빌드와 Opened 이벤트 경로가 같은지 확인).

- [ ] Step 3: 커밋

```bash
git add docs/spec/windows.md docs/PLAN.md
git commit -m "docs(spec): 다중 창 수동 검증 결과 기록"
```
