# 네이밍 컨벤션

## 1. 파일, 디렉터리

- 직접 작성하는 애플리케이션 파일명은 **케밥 케이스(kebab-case)**로 작성한다.
  - 예: `format-markdown.ts`, `use-document.ts`, `editor.tsx`
  - React 컴포넌트 파일도 동일하게 작성한다: `editor.tsx`, `app.tsx`
  - 테스트 파일은 대상 파일명에 `.test`를 붙인다: `format-markdown.test.ts`
- 파일명은 `types.ts`, `utils.ts`, `helpers.ts`처럼 기술 역할만 나타내지 않고 도메인이나 목적을 드러낸다.
  - 예: `window-title.ts`, `format-markdown.ts`, `document-shortcuts.ts`
- 직접 작성하는 애플리케이션 디렉터리명도 케밥 케이스로 작성한다.
  - 예: `src/lib`, `src-tauri/capabilities`
- 도구나 플랫폼이 이름을 정한 파일은 해당 규칙을 따른다.
  - 예: `index.html`, `vite.config.ts`, `tsconfig.node.json`, `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `src-tauri/src/lib.rs`
- `public/`의 파일명은 배포 URL에 그대로 반영된다. 직접 정할 수 있다면 케밥 케이스를 사용하고, 외부 규격이 요구하는 이름은 유지한다.

## 2. React 컴포넌트

- React 컴포넌트명은 **파스칼 케이스(PascalCase)**로 작성한다.
  - JSX에서 소문자로 시작하면 DOM 태그로 해석되므로 컴포넌트는 반드시 대문자로 시작한다.

즉, 파일명과 컴포넌트명은 다음과 같이 짝을 이룬다.

```tsx
// editor.tsx  ← 파일명: 케밥 케이스
export function Editor() {
  // 컴포넌트명: 파스칼 케이스
}
```

## 3. React 훅

- 훅 파일명은 `use-` 접두사 + 케밥 케이스로 작성한다: `use-document.ts`
- 훅 함수명은 `use` 접두사 + 카멜 케이스로 작성한다: `useDocument`

## 4. TypeScript 식별자와 환경 변수

- 변수와 함수명은 **카멜 케이스(camelCase)**로 작성한다: `filePath`, `formatMarkdown`
- 타입과 인터페이스명은 **파스칼 케이스**로 작성한다: `EditorHandle`, `DocumentAction`
- 클라이언트 코드에서 사용할 환경 변수는 `VITE_` 접두사 + **대문자 스네이크 케이스(SCREAMING_SNAKE_CASE)**로 작성한다: `VITE_API_BASE_URL`
  - `VITE_` 접두사가 붙은 값은 클라이언트 번들에 노출되므로 비밀값을 저장하지 않는다.

## 5. 약어(acronym) 표기

- 식별자 안의 약어도 일반 단어처럼 취급한다.
  - 컴포넌트: `ApiKeyPanel` (O) / `APIKeyPanel` (X)
  - 변수: `apiKey` (O) / `APIKey` (X)
  - 파일: `api-key-panel.tsx`
- 브라우저 API나 외부 규격이 정의한 이름은 원래 표기를 유지한다: `URL`, `HTMLInputElement`

## 6. 정리

| 대상                  | 표기법                         | 예시                                   |
| --------------------- | ------------------------------ | -------------------------------------- |
| 애플리케이션 파일명   | kebab-case                     | `editor.tsx`, `window-title.ts`        |
| 애플리케이션 디렉터리 | kebab-case                     | `src/lib`, `src-tauri/capabilities`    |
| React 컴포넌트명      | PascalCase                     | `function Editor() { ... }`            |
| React 훅 함수명       | `use` + camelCase              | `useDocument`                          |
| 변수명, 함수명        | camelCase                      | `filePath`, `formatMarkdown`           |
| 타입명, 인터페이스명  | PascalCase                     | `EditorHandle`, `DocumentAction`       |
| 클라이언트 환경 변수  | `VITE_` + SCREAMING_SNAKE_CASE | `VITE_API_BASE_URL`                    |