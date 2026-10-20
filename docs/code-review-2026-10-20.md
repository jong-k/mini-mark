# 코드 리뷰 분류 (2026-10-20)

PLAN.md 4단계 완료 시점의 전체 코드베이스 리뷰 결과를 분류한다. 외부 리뷰 6개 항목과 개선 제안 5개, 내부 리뷰 항목을 함께 다룬다. 외부 리뷰 항목은 모두 코드를 다시 읽어 확인했다. 재현 여부가 "코드 확인"인 항목은 실행하지 않고 코드 경로로 확인한 것이다.

검증 상태: tsc, Vitest 76개, cargo clippy, cargo test 21개 통과. 작업 트리 변경 없음.

## 분류 기준

- 지금 고침: 데이터 유실, 권한 변경, 또는 수정 비용이 몇 줄 이내인 항목
- 나중에 고침: 사실이지만 발생 조건이 좁거나, 제품 결정 또는 측정이 먼저 필요한 항목
- 무시: 영향이 없거나 제안한 해결 방식이 문제 크기에 비해 과한 항목. 과한 방식만 무시하고 문제 자체는 다른 분류에 둔 경우 함께 적는다

## 지금 고침

### 1. 저장 시 파일 권한이 넓어짐 (외부 P1-3)

- 위치: `src-tauri/src/fs.rs:27`
- 확인: 사실. `OpenOptions`가 umask 기본값(0644)으로 임시 파일을 만들고 rename으로 원본을 교체한다. 0600 파일이 저장 후 0644가 된다.
- 조치: 임시 파일을 `OpenOptionsExt::mode(0o600)`으로 만든다. rename 전에 원본이 있으면 `fs::metadata(&path)`의 권한을 `fs::set_permissions(&tmp, ...)`로 복사한다. 원본이 없으면 0644로 되돌린다. xattr(Finder 태그)는 이번에 다루지 않는다.
- 테스트: 0600 원본 저장 후 권한 유지, 새 파일은 0644.

### 2. 파일을 여는 동안 입력한 내용이 사라짐 (외부 P1-1)

- 위치: `src/app.tsx:62-65`
- 확인: 사실. `confirmDiscard`는 `readMarkdown` 전에만 묻는다. 읽는 동안 입력하면 `setValue`가 덮어쓴다. 로컬 파일은 수십 ms 창이지만 네트워크 볼륨에서는 길어진다.
- 조치: 읽기 전 `changeCount.current`를 기억하고, 읽은 뒤 달라졌으면 `confirmDiscard`를 다시 묻는다. 거절하면 전환을 중단한다. 폴링(`pollFileChange`)과 같은 방식이다.

### 3. 외부 변경을 감지하기 전에 저장하면 덮어씀 (외부 P1-2, 해결 방식은 축소)

- 위치: `src/app.tsx:90-92`
- 확인: 사실. 외부 수정 후 2초 폴링 전에 Cmd+S를 누르면 확인 없이 덮어쓴다.
- 조치: `saveDocument`에서 `path === filePath`이고 `knownMtime.current !== null`이면 저장 전에 `fileModifiedAt(path)`를 조회해 비교한다. 다르면 "디스크의 파일이 바뀌었습니다. 덮어쓰시겠습니까?"를 묻는다. 거절하면 저장을 중단한다.
- 무시하는 부분: Rust 커맨드에 예상 버전을 전달해 충돌을 판정하는 방식. stat과 rename 사이의 경합은 남지만 단일 사용자 로컬 편집기에서는 2초 폴링 창을 닫는 것으로 충분하다.

### 4. 본문 없는 front matter 문서에 입력하면 구분자가 붙음 (외부 P2-4)

- 위치: `src/markdown-editor.ts:186,189`
- 확인: 사실. 정규식 끝의 `(?:\r?\n|$)`가 EOF에 매치하면 `frontMatter`가 개행 없이 끝난다. 본문을 입력하면 `---body`가 된다.
- 조치: `getValue`에서 본문이 비어 있지 않고 `frontMatter`가 비어 있지 않으며 `\n`으로 끝나지 않으면 사이에 `\n`을 넣는다. 기존 테스트 "닫는 --- 뒤 EOF"는 본문이 없으므로 그대로 통과한다.

### 5. 열기 시 읽은 내용과 감시 기준 mtime의 순서 (외부 P2-5의 열기 부분)

- 위치: `src/app.tsx:63,68`
- 확인: 사실. 읽기 뒤에 stat하므로 그 사이의 외부 수정은 화면에 반영되지 않고 기준값만 최신이 되어 감지를 놓친다.
- 조치: `fileModifiedAt`을 `readMarkdown` 앞으로 옮긴다. 그러면 같은 경합에서 내용은 새 것, 기준값은 옛 것이 되어 다음 폴링이 다시 불러온다. 실패 모드가 "변경 누락"에서 "불필요한 reload 한 번"으로 바뀐다.
- 저장 쪽은 나중에 고침 1번에서 다룬다.

### 6. 최근 목록 저장 실패가 열기와 저장 성공 뒤 오류로 보임 (내부)

- 위치: `src/app.tsx:69,101`
- 확인: `run()`이 `addRecentFile` 오류를 잡아 대화상자로 표시한다. 문서 동작은 이미 성공했다.
- 조치: `await addRecentFile(path).catch(() => {})`.

### 7. fs 커맨드가 메인 스레드에서 실행됨 (내부)

- 위치: `src-tauri/src/fs.rs`의 커맨드 4개
- 확인: Tauri 2 문서에 따르면 `async`가 아닌 커맨드는 메인 스레드에서 실행된다. `save_markdown_atomic`의 `sync_all`과 `save_asset`의 수 MB 쓰기가 UI를 멈춘다.
- 조치: `read_markdown`, `save_markdown_atomic`, `save_asset`, `file_modified_at`에 `#[tauri::command(async)]`를 붙인다. `add_recent_file`은 메뉴를 조작하므로 그대로 둔다.
- 검증: `pnpm tauri dev`에서 열기, 저장, 이미지 붙여넣기 수동 확인.

### 8. 미사용 의존성 제거 (내부)

- 위치: `src-tauri/Cargo.toml:22`, `src-tauri/src/lib.rs:47`, `src-tauri/capabilities/default.json:10`, `package.json:18`
- 확인: `tauri-plugin-opener`와 `@tauri-apps/plugin-opener`를 프론트엔드 어디서도 import하지 않는다. `opener:default`는 웹뷰에서 임의 URL 열기를 허용한다.
- 조치: 네 곳 모두 제거한다. `dialog:allow-ask`는 `dialog:default`에 포함되므로 함께 지운다.

### 9. PLAN.md의 구현 완료와 성능 검증 완료 구분 (외부 개선 5)

- 위치: `docs/PLAN.md:89`
- 확인: 측정 결과 항목에 "수치 미측정"이 이미 적혀 있지만 체크박스는 완료로 표시되어 있다.
- 조치: 해당 줄을 "성능 프로파일링 (유휴 메모리 측정 완료, 콜드 스타트와 타이핑 지연은 수치 미측정)"으로 고친다.

## 나중에 고침

### 1. 저장 직후 mtime 조회의 경합 (외부 P2-5의 저장 부분)

- 위치: `src/app.tsx:98`
- 확인: 사실. rename과 stat 사이에 외부 수정이 들어오면 그 수정의 mtime을 기준값으로 삼아 감지를 놓친다. 창이 ms 단위라 발생 가능성이 낮다.
- 조치: `save_markdown_atomic`이 rename 전 임시 파일의 mtime을 `u64`로 반환하고 프론트엔드가 그 값을 기준값으로 쓴다. rename은 mtime을 유지한다. 지금 고침 5번과 같은 성격이지만 Rust 시그니처가 바뀌므로 분리한다.

### 2. 다른 폴더에 저장하면 상대 링크가 깨짐 (외부 P2-6)

- 위치: `src/markdown-editor.ts:54`
- 확인: 사실. 이미지만 재계산하고 `[other](other.md)` 같은 로컬 링크는 그대로 둔다.
- 보류 이유: 제품 결정이 필요하다. 이미지는 렌더링 때문에 경로를 다루지만 링크 재작성은 일반 편집기(VS Code 등)도 하지 않는다. 다만 이미지와 링크의 동작이 다른 점은 사용자가 혼란스러울 수 있다. 결정 후에는 `linkSchema.extendSchema`로 이미지와 같은 방식을 적용하면 된다.

### 3. 이미지 데코레이션을 입력마다 전체 재계산 (외부 개선 1, 내부 14)

- 위치: `src/markdown-editor.ts:94`
- 보류 이유: ponytail 주석으로 기록된 알려진 상한. 이미지 수백 장 문서에서 타이핑 지연이 측정되면 `set.map(tr.mapping, tr.doc)` 후 삽입된 이미지만 추가하는 방식으로 바꾼다.

### 4. 이미지를 `number[]` JSON으로 전송 (외부 개선 2, 내부 13)

- 위치: `src/lib/tauri.ts:20`, `src-tauri/src/fs.rs:48`
- 보류 이유: ponytail 주석으로 기록된 알려진 상한. 지금 고침 7번으로 메인 스레드 차단은 해소된다. 수 MB 이미지에서 지연이 측정되면 `invoke("save_asset", new Uint8Array(buf), { headers })`와 `tauri::ipc::Request`로 바꾼다.

### 5. App 문서 생명주기 테스트 부재 (외부 개선 4)

- 보류 이유: `app.tsx`는 Tauri에 묶여 있어 Vitest로 직접 테스트하기 어렵다. AGENTS.md는 Tauri 연동을 수동 검증 대상으로 둔다. 지금 고침 2, 3, 5번을 적용하면서 열기와 저장의 판정 로직을 `file-watch.ts`처럼 순수 함수로 뽑아내면 그때 테스트를 붙인다.

### 6. 작업 목록 체크박스 접근성 (외부 개선 3)

- 위치: `src/app.css:77`
- 확인: 사실. 체크박스는 CSS `::before` 문자와 클릭 처리뿐이다. 키보드로 토글할 수 없고 체크 상태가 보조 기술에 전달되지 않는다.
- 보류 이유: 우선순위 낮음. 적용 시 `li[data-item-type="task"]`에 `role="checkbox"`와 `aria-checked`를 붙이고 `toggleTaskItem`을 호출하는 키 바인딩을 추가한다.

### 7. 외부 변경 reload가 내용이 같아도 undo 기록을 지움 (내부 7)

- 위치: `src/app.tsx:152-155`
- 조치 후보: `formatMarkdown(result.content) === formatMarkdown(h.getValue())`면 기준값만 갱신한다. git checkout이나 포매터 재저장이 흔한 트리거다.

### 8. `app.tsx`의 최신값 ref 4벌 (내부 9)

- 위치: `src/app.tsx:123-129,157-158`
- 보류 이유: 동작은 맞다. 지금 고침 2, 3, 5번으로 `openPath`와 `saveDocument`가 더 길어지면 그때 `filePath`와 `isDirty`를 ref 하나로 합칠지 판단한다. AGENTS.md의 "React 상태는 문서 메타데이터만" 문구와 맞출 필요가 있다.

## 무시

- 외부 P1-2의 해결 방식 중 "저장 시 예상 파일 버전을 Rust에 전달": 문제는 지금 고침 3번에서 stat 비교로 해결한다. 커맨드 시그니처와 Rust 쪽 판정 로직을 추가할 만큼의 위험이 아니다.
- 외부 P2-5의 해결 방식 중 "내용과 버전을 함께 반환하고 읽기 전후 버전 검증": 지금 고침 5번의 순서 변경으로 실패 모드가 무해해진다. 저장 쪽은 나중에 고침 1번의 반환값 하나로 충분하다.
- 내부에서 나온 사소한 항목: `csp: null`(Milkdown이 raw HTML을 렌더링하지 않음), `index.html`의 `lang="en"`, 비 UTF-8 파일 오류 메시지 문구. 영향이 없거나 사용자 요청이 있을 때 다룬다.
- 외부 리뷰의 "Vitest 75개"는 현재 76개다. 수치 차이만 있고 결과는 같다.

## 적용 순서

1. 지금 고침 1, 4 (Rust 권한, front matter): 각각 테스트와 함께 커밋
2. 지금 고침 2, 3, 5, 6 (app.tsx 열기와 저장 흐름): 한 커밋
3. 지금 고침 7, 8 (커맨드 async, 의존성 제거): `pnpm tauri dev`로 수동 검증 후 커밋
4. 지금 고침 9 (PLAN.md): docs 커밋

## 적용 상태 (2026-10-20)

지금 고침 9개를 커밋 세 개로 적용했다. 자동 검사(tsc, Vitest, clippy, cargo test, vite build)는 통과했다. 지금 고침 7번(커맨드 async)과 8번(opener 제거)은 `pnpm tauri dev`에서 열기, 저장, 이미지 붙여넣기, 외부 변경 후 저장 확인 대화상자를 수동으로 확인해야 한다.
