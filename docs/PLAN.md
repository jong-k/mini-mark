# macOS 경량 마크다운 에디터 개발 계획

Typora 스타일의 위지윅(WYSIWYM) 편집 경험과 빠른 실행 속도, 안전한 로컬 파일 입출력을 목표로 하는 macOS 데스크탑 마크다운 에디터 프로젝트다.

---

## 1. 핵심 목표 및 설계 원칙

- 경량화: Chromium을 내장하지 않고 macOS 기본 웹뷰(WKWebView)를 사용하여 앱 용량(10MB 이하)과 유휴 메모리 점유율을 최소화한다.
- 한글(IME) 입력 안정성: 실시간 DOM 교체로 인한 한글 자소 분리나 조합 씹힘 현상이 없는 리치 텍스트 에디터 엔진을 사용한다.
- 데이터 무결성 및 일관성: 파일 쓰기 중 크래시가 발생해도 원본이 손상되지 않도록 원자적 저장(Atomic Save)을 적용하고, 저장 시 Prettier 포매터를 거쳐 마크다운 문법과 개행(LF)을 일관되게 정리한다.
- 단방향 데이터 흐름: 타이핑 중 React 리렌더링이 발생하지 않도록 에디터 인스턴스를 단일 진실 공급원(Single Source of Truth)으로 유지한다.

---

## 2. 확정 기술 스택

| 영역 | 사용 기술 | 선정 이유 |
| --- | --- | --- |
| 데스크탑 런타임 | Tauri v2 (Rust) | WKWebView 기반의 가벼운 런타임, 네이티브 다이얼로그 제어 및 Rust 기반 안전한 파일 I/O 구현 |
| 프론트엔드 코어 | React + TypeScript + Vite | 빠른 번들링 및 UI 컴포넌트 상태 관리 |
| 에디터 엔진 | Milkdown (ProseMirror 기반) | 마크다운 친화적인 위지윅(WYSIWYM) 렌더링, GFM(표, 체크박스 등) 플러그인 생태계, 안정적인 한글 IME 입력 |
| 마크다운 포매터 | Prettier (`prettier/standalone`) | 저장 시점에 마크다운 AST 직렬화 결과를 일정한 규칙과 LF 개행으로 자동 포매팅. 콜드 스타트 보호를 위해 첫 저장 시 `import()`로 지연 로드. Milkdown 직렬화기(remark-stringify)와 역할이 겹치므로 2단계 이후 제거 여부 재검토 |
| 스타일링 | Tailwind CSS + Typography | 에디터 본문 타이포그래피 및 다크 모드 스타일링 간소화 |

---

## 3. 단계별 실행 로드맵 (4단계)

### 1단계: 파일 앱 뼈대 및 안전한 I/O 파이프라인 구축
에디터 엔진을 붙이기 전 기본 `<textarea>` 상태에서 파일 입출력과 문서 생명주기를 먼저 완성한다. 본문은 React 상태에 두지 않고 `EditorHandle { getValue, setValue }` 인터페이스 뒤에 숨긴다. 2단계에서 이 인터페이스 구현체만 Milkdown으로 교체한다.

상세 태스크: [`superpowers/plans/2026-10-19-phase1-file-io.md`](superpowers/plans/2026-10-19-phase1-file-io.md)

- [x] Tauri v2 프로젝트 스캐폴딩 및 `dialog` 플러그인 연동
- [ ] Rust 백엔드: 파일 읽기(`read_markdown`) 및 임시 파일 생성 후 교체하는 원자적 저장(`save_markdown_atomic`) 커맨드 구현
- [ ] 프론트엔드: Prettier standalone 마크다운 포매터 유틸리티 작성 (지연 로드, 파싱 에러 시 원본 보존 예외 처리 포함)
- [ ] 문서 상태(`filePath`, `isDirty`) 관리 및 창 타이틀바 수정 표시(`•`) 동기화
- [ ] 전역 단축키(`Cmd + O`, `Cmd + S`, `Cmd + Shift + S`, `Cmd + N`) 바인딩
- [ ] 미저장 상태에서 창 닫기나 다른 파일 열기 시 경고 모달 방어 로직 구현

### 2단계: Milkdown 에디터 코어 교체 및 단방향 바인딩
`<textarea>`를 들어내고 Milkdown 에디터를 마운트하여 기본 위지윅 마크다운 편집을 구현한다.

- [ ] `@milkdown/core`, `@milkdown/preset-commonmark`, `@milkdown/react` 설치 및 초기 설정
- [ ] 단방향 데이터 플로우 연결
  - 파일 열기: 읽어온 문자열로 에디터 인스턴스 초기화
  - 편집 중: `listener` 플러그인으로 문서 변경 시 `isDirty` 상태만 업데이트 (React 리렌더링 차단)
  - 파일 저장: `Cmd + S` 입력 시점에만 에디터에서 마크다운 문자열을 추출하여 Prettier 포매팅 후 디스크에 기록 (타이핑 중 커서 튐 방지)
- [ ] 한글 IME 조합 테스트 (제목, 굵게, 리스트 등 마크다운 Input Rule 변환 직후 한글 입력 시 자소 분리 여부 검증)
- [ ] Prettier 제거 여부 판단: Milkdown `getMarkdown()` 출력(remark-stringify)이 충분히 일관되면 Prettier를 빼고 LF 정규화와 끝 개행만 남긴다

### 3단계: Typora 스타일 UI 및 확장 렌더링 고도화
마크다운 확장 문법을 붙이고 로컬 에셋 처리와 스타일을 다듬는다.

- [ ] `@milkdown/preset-gfm` 연동 (표, 취소선, 작업 목록 체크박스, 각주 지원)
- [ ] `@milkdown/plugin-prism` 또는 Shiki 기반 코드 블록 구문 강조 적용
- [ ] 로컬 이미지 렌더링 및 붙여넣기 처리
  - 마크다운 내 상대 경로 이미지를 웹뷰에 띄우기 위해 Tauri `convertFileSrc` 및 Asset 프로토콜 스코프 설정
  - 에디터에 이미지 클립보드 붙여넣기 및 드래그 앤 드롭 시 현재 문서 하위 폴더(예: `./assets`)에 저장 후 상대 경로 삽입
- [ ] 본문 타이포그래피 스타일링 및 시스템 설정 연동 다크 모드 적용

### 4단계: macOS 네이티브 통합 및 패키징
실제 데스크탑 앱으로서의 사용성을 완성하고 배포용 번들을 생성한다.

- [ ] Finder 연동 (`fileAssociations` 설정으로 `.md` 파일 더블클릭 및 드래그 앤 드롭 시 앱으로 열기 처리)
- [ ] 외부 프로그램에 의한 현재 열린 파일 변경 감지(File Watcher) 및 리로드 알림
- [ ] 최근 열었던 파일(Recent Files) 목록 관리
- [ ] 성능 프로파일링 (콜드 스타트 속도, 유휴 메모리 100MB 이내, 대용량 문서 타이핑 지연 확인)
- [ ] macOS `.app` 및 `.dmg` 프로덕션 빌드 테스트
