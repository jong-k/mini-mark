## 규칙

- 마크다운, 코드 주석, 커밋 메시지 등 모든 텍스트를 작성할 때 가운뎃점 문자를 사용하지 않는다.

## 컨벤션

- 커밋 메시지 작성 시 docs/conventions/commit-convention.md 를 따른다.
- 파일, 디렉터리 및 코드 식별자 작성 시 docs/conventions/naming-convention.md 를 따른다.
- 화면 문구와 코드 용어 작성 시 docs/conventions/terminology.md 를 따른다.

## 프론트엔드 구조

- 디렉터리 구조는 평면(flat)으로 유지한다. `src/` 바로 아래에 파일을 두고, 순수 유틸리티만 `src/lib/`에 모은다. FSD나 레이어 구조를 적용하지 않는다.
- `src/` 파일 수가 15개를 넘으면 기능별 폴더(예: `editor/`, `document/`, `images/`)로 옮긴다. 그 전에는 폴더를 만들지 않는다.
- 에디터 본문은 React 상태에 두지 않는다. 본문 접근은 `EditorHandle { getValue, setValue }` 인터페이스를 통해서만 한다. React 상태는 `filePath`, `isDirty` 같은 문서 메타데이터만 가진다.
- 에디터 엔진 교체(textarea, Milkdown)는 `EditorHandle` 구현체 교체로 끝나야 한다. 상위 컴포넌트가 엔진 API를 직접 호출하지 않는다.
- Tauri `invoke`와 플러그인 호출은 `src/lib/tauri.ts` 래퍼를 거친다. 컴포넌트에서 `invoke`를 직접 호출하지 않는다.
- 순수 함수(포매터, 타이틀, 단축키 매칭)는 Vitest로 테스트한다. Tauri 연동은 `pnpm tauri dev`로 수동 검증한다.
- 무거운 의존성(Prettier 등)은 정적 import 대신 사용 시점에 `import()`로 지연 로드한다.

## Rust (src-tauri)

- 별도 컨벤션 문서 없음. `cargo fmt`와 `cargo clippy` 기본 설정을 따른다.
- 명명은 Rust 표준(함수와 변수 snake_case, 타입 PascalCase, 상수 SCREAMING_SNAKE_CASE)을 따른다. Tauri 커맨드 함수명도 snake_case로 쓰고 프론트엔드 `invoke` 문자열과 동일하게 맞춘다.
- 커맨드 에러는 `Result<T, String>`으로 반환한다. 프론트엔드가 문자열로 표시한다.
