# 린터와 포매터 도입 구현 계획

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: JS/TS에 Oxlint(type-aware 포함)와 oxfmt를 도입하고, Rust는 기존 `cargo fmt`, `cargo clippy`를 pnpm 스크립트로 묶는다.

Architecture: 설정 파일은 루트의 `.oxlintrc.json`, `.oxfmtrc.json` 두 개다. 포맷은 oxfmt 기본값(printWidth 100)을 쓴다. 기존 코드가 폭 100 기준이라 diff가 가장 작다(13파일, 80으로 하면 18파일 650줄). Rust 쪽은 설정 파일 없이 스크립트 두 줄만 추가한다. 현재 `cargo fmt --check`와 `clippy -D warnings`가 모두 통과한다.

Tech Stack: oxlint 1.89.0, oxlint-tsgolint 7.0.2004, oxfmt 0.74.0, pnpm, rustfmt, clippy

Spec: 이 계획 자체가 스펙이다(2026-10-20 대화에서 Oxlint + oxfmt 선택).

## Global Constraints

- devDependencies에 추가하는 것은 `oxlint`, `oxlint-tsgolint`, `oxfmt` 세 개뿐이다. ESLint, Prettier와 그 플러그인은 넣지 않는다.
- oxfmt는 0.x(beta)이므로 정확한 버전으로 고정한다(`pnpm add -D -E`). oxlint와 oxlint-tsgolint도 `-E`로 고정해 tsgolint 짝을 맞춘다.
- Markdown도 포맷한다. oxfmt 기본값(`proseWrap: "preserve"`)이라 문단 줄바꿈은 그대로 두고, 표 정렬과 목록 앞 빈 줄, 문서 안 코드 블록만 바뀐다.
- 린트 경고는 실패로 취급한다(`--deny-warnings`). 경고를 쌓아두지 않는다.
- 규칙 끄기는 근거가 있는 곳에만, 가장 좁은 범위(줄 단위 주석 또는 테스트 파일 override)로 한다.
- 가운뎃점 문자를 쓰지 않는다. 커밋 메시지는 `docs/conventions/commit-convention.md`를 따르고, 본문 없이 Co-Authored-By 꼬리말만 붙인다(기존 커밋과 동일).

## Review Focus

- `editor.tsx`의 ref 동기화를 `useLayoutEffect`로 옮긴 뒤에도 입력 즉시 창 제목에 수정 표시가 붙어야 한다(`pnpm tauri dev`에서 타이핑으로 확인).
- 일괄 포맷 뒤에도 동작이 같아야 한다. `pnpm build`(tsc 포함)와 `pnpm test`가 포맷 전과 같이 통과해야 한다.
- `pnpm fmt`가 gitignore 대상(`dist`, `src-tauri/gen/schemas`, `src-tauri/target`)과 `pnpm-lock.yaml`을 건드리지 않아야 한다. 포맷 후 `git status`로 확인한다.
- Markdown 포맷이 렌더 결과를 바꾸면 안 된다. 인라인 코드 안 백틱(phase3 계획서 32행의 ` ``` ` 가 ` ``` ` 로 바뀜)과 표가 포맷 전과 같게 보이는지 diff로 확인한다.
- `app.tsx` 마운트 이펙트는 의존성을 비운 채 유지해야 한다. 의존성을 채우면 매 렌더마다 리스너가 재등록된다. 린트 경고는 주석으로만 끈다.
- type-aware 규칙이 실제로 돈다. floating promise를 일부러 넣으면 `pnpm lint`가 실패해야 한다(Task 1 Step 4).

---

### Task 1: Oxlint 도입과 기존 경고 해소

Files:

- Create: `.oxlintrc.json`
- Modify: `package.json` (devDependencies, scripts)
- Modify: `src/editor.tsx:27-32` (ref 동기화), `src/editor.tsx:51` (deps 배열)
- Modify: `src/app.tsx:183` 위 (disable 주석)
- Modify: `.vscode/extensions.json`

Interfaces:

- Produces: `pnpm lint` 스크립트 (`oxlint --deny-warnings`)

- [ ] Step 1: 설치

Run: `pnpm add -D -E oxlint@1.89.0 oxlint-tsgolint@7.0.2004`

- [ ] Step 2: `.oxlintrc.json` 작성

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "react"],
  "options": { "typeAware": true },
  "ignorePatterns": ["dist/**", "src-tauri/**"],
  "rules": {
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error"
  },
  "overrides": [
    {
      "files": ["**/*.test.ts"],
      "rules": { "react/globals": "off" }
    }
  ]
}
```

`plugins`는 기본 집합을 덮어쓰므로 기본 4개(eslint, typescript, unicorn, oxc)에 react를 더해 모두 적는다. vitest 플러그인은 넣지 않는다(경고 8건이 전부 `vi.fn` 타입 인자 스타일이라 얻는 게 없다). 테스트 override는 `deferred.test.ts`의 Probe 컴포넌트가 의도적으로 바깥 변수에 대입하기 때문이다. 규칙 이름이 `react/globals`로 안 먹으면 `pnpm lint` 출력의 규칙명에 맞춘다.

- [ ] Step 3: `package.json` scripts에 `"lint": "oxlint --deny-warnings"` 추가

- [ ] Step 4: type-aware 동작 확인

`src/__probe.ts`에 `async function f() {}` 와 `export function g() { f(); }` 를 넣고 `pnpm lint` 실행.
Expected: `typescript(no-floating-promises)` error로 실패. 확인 후 파일 삭제.

- [ ] Step 5: 경고 해소

`pnpm lint` 실행 시 남는 경고 4건을 아래처럼 처리한다.

- `src/editor.tsx` `react(refs)` 2건: 렌더 중 `onChangeRef.current = onChange; onReadyRef.current = onReady;` 대입을 인자 없는 `useLayoutEffect(() => { ... })` 안으로 옮긴다. 기존 주석(매 렌더 새 onChange 이유)은 유지한다. `useRef` 초기값이 첫 렌더를 덮으므로 동작이 같다.
- `src/editor.tsx` `exhaustive-deps`(`handleRef`): 51행 deps 배열을 `[handleRef]`로 바꾼다. `app.tsx`의 `useRef` 객체라 참조가 바뀌지 않아 재실행되지 않는다.
- `src/app.tsx` `exhaustive-deps`: 경고가 가리키는 줄 바로 위에 `// oxlint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만 등록한다. 핸들러는 doc ref로 최신값을 읽는다.` 를 넣는다. deps는 비운 채 둔다.

- [ ] Step 6: 검증

Run: `pnpm lint && pnpm test && pnpm build`
Expected: lint 경고와 에러 0, 테스트 전부 통과, 빌드 성공.
수동: `pnpm tauri dev`로 파일을 열고 타이핑하면 창 제목에 수정 표시가 붙는다.

- [ ] Step 7: `.vscode/extensions.json`의 recommendations에 `"oxc.oxc-vscode"` 추가

- [ ] Step 8: 커밋

```bash
git add .oxlintrc.json package.json pnpm-lock.yaml src/editor.tsx src/app.tsx .vscode/extensions.json
git commit -m "chore(lint): Oxlint 도입, 기존 경고 해소"
```

### Task 2: oxfmt 도입과 일괄 포맷

Files:

- Create: `.oxfmtrc.json`
- Modify: `package.json` (devDependencies, scripts)
- Modify: oxfmt가 바꾸는 파일 전부(코드 13개: `src/**`, `package.json`, `src-tauri/*.json`, `src-tauri/capabilities/*.json`, 문서 9개: `docs/**/*.md`)

Interfaces:

- Consumes: Task 1의 `pnpm lint`
- Produces: `pnpm fmt`, `pnpm fmt:check`

- [ ] Step 1: 설치

Run: `pnpm add -D -E oxfmt@0.74.0`

- [ ] Step 2: `.oxfmtrc.json` 작성

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json"
}
```

옵션은 모두 기본값을 쓴다. 파일이 없으면 oxfmt가 실행마다 "No config found" 경고를 내므로 `$schema`만 둔다.

- [ ] Step 3: scripts에 `"fmt": "oxfmt"`, `"fmt:check": "oxfmt --check"` 추가 후 설정만 먼저 커밋

```bash
git add .oxfmtrc.json package.json pnpm-lock.yaml
git commit -m "chore(fmt): oxfmt 도입"
```

설정 커밋과 포맷 커밋을 나눠 리뷰와 blame 추적을 쉽게 한다.

- [ ] Step 4: 일괄 포맷 실행

Run: `pnpm fmt && git status --short`
Expected: 변경 파일이 `src/`, `docs/`, `package.json`, `src-tauri/*.json`, `src-tauri/capabilities/` 안에만 있다. `pnpm-lock.yaml`, `dist`, `src-tauri/gen`은 없다. 이 계획 문서 자체도 포맷 대상이다.

- [ ] Step 5: 검증

Run: `pnpm fmt:check && pnpm lint && pnpm test && pnpm build`
Expected: 모두 통과.

- [ ] Step 6: 커밋 (Step 4에서 확인한 파일만 이름으로 stage)

```bash
git commit -m "style: oxfmt 일괄 포맷"
```

### Task 3: Rust 스크립트와 AGENTS.md 갱신

Files:

- Modify: `package.json` (scripts)
- Modify: `AGENTS.md`

- [ ] Step 1: scripts 추가

```json
"fmt:rs": "cargo fmt --manifest-path src-tauri/Cargo.toml",
"lint:rs": "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
```

- [ ] Step 2: 검증

Run: `pnpm fmt:rs && git status --short src-tauri && pnpm lint:rs`
Expected: `src-tauri` 변경 없음, clippy 경고 0.

- [ ] Step 3: `AGENTS.md` 갱신

`## 프론트엔드 구조` 끝에 한 줄 추가:
`- JS/TS 린트는 Oxlint(.oxlintrc.json), 포맷은 oxfmt 기본 설정을 따른다. 커밋 전 pnpm lint, pnpm fmt:check를 통과시킨다.`

`## Rust (src-tauri)` 첫 줄을 다음으로 바꾼다:
`- 별도 컨벤션 문서 없음. cargo fmt와 cargo clippy 기본 설정을 따른다. Rust를 고치면 커밋 전 pnpm fmt:rs, pnpm lint:rs를 실행한다.`

- [ ] Step 4: 커밋

```bash
git add package.json AGENTS.md
git commit -m "chore(rust): fmt, clippy 스크립트 추가, AGENTS.md에 린트 규칙 기록"
```
