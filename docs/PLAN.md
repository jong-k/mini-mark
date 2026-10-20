# macOS 경량 마크다운 에디터 개발 계획

Typora 스타일의 위지윅(WYSIWYM) 편집 경험과 빠른 실행 속도, 안전한 로컬 파일 입출력을 목표로 하는 macOS 데스크탑 마크다운 에디터 프로젝트다.

---

## 1. 핵심 목표 및 설계 원칙

- 경량화: Chromium을 내장하지 않고 macOS 기본 웹뷰(WKWebView)를 사용하여 앱 용량(10MB 이하)과 유휴 메모리 점유율을 최소화한다.
- 한글(IME) 입력 안정성: 실시간 DOM 교체로 인한 한글 자소 분리나 조합 씹힘 현상이 없는 리치 텍스트 에디터 엔진을 사용한다.
- 데이터 무결성 및 일관성: 파일 쓰기 중 크래시가 발생해도 원본이 손상되지 않도록 원자적 저장(Atomic Save)을 적용하고, 저장 시 개행(LF)과 끝 개행을 일관되게 정리한다. 마크다운 문법은 Milkdown 직렬화기가 결정적으로 출력한다.
- 단방향 데이터 흐름: 타이핑 중 React 리렌더링이 발생하지 않도록 에디터 인스턴스를 단일 진실 공급원(Single Source of Truth)으로 유지한다.

---

## 2. 확정 기술 스택

| 영역 | 사용 기술 | 선정 이유 |
| --- | --- | --- |
| 데스크탑 런타임 | Tauri v2 (Rust) | WKWebView 기반의 가벼운 런타임, 네이티브 다이얼로그 제어 및 Rust 기반 안전한 파일 I/O 구현 |
| 프론트엔드 코어 | React + TypeScript + Vite | 빠른 번들링 및 UI 컴포넌트 상태 관리 |
| 에디터 엔진 | Milkdown (ProseMirror 기반) | 마크다운 친화적인 위지윅(WYSIWYM) 렌더링, GFM(표, 체크박스 등) 플러그인 생태계, 안정적인 한글 IME 입력 |
| 마크다운 포매터 | 없음 (2단계에서 Prettier 제거) | Milkdown 직렬화(remark-stringify) 출력이 결정적이라 별도 포매터 불필요. 저장 시 LF 정규화와 끝 개행만 적용 |
| 스타일링 | 순수 CSS (CSS 변수 + prefers-color-scheme) | 3단계에서 Tailwind 대신 선택. 에디터 본문 하나뿐이라 유틸리티 클래스가 필요 없음 |

---

## 3. 단계별 실행 로드맵 (4단계)

### 1단계: 파일 앱 뼈대 및 안전한 I/O 파이프라인 구축
에디터 엔진을 붙이기 전 기본 `<textarea>` 상태에서 파일 입출력과 문서 생명주기를 먼저 완성한다. 본문은 React 상태에 두지 않고 `EditorHandle { getValue, setValue }` 인터페이스 뒤에 숨긴다. 2단계에서 이 인터페이스 구현체만 Milkdown으로 교체한다.

상세 태스크: [`superpowers/plans/2026-10-19-phase1-file-io.md`](superpowers/plans/2026-10-19-phase1-file-io.md)

- [x] Tauri v2 프로젝트 스캐폴딩 및 `dialog` 플러그인 연동
- [x] Rust 백엔드: 파일 읽기(`read_markdown`) 및 임시 파일 생성 후 교체하는 원자적 저장(`save_markdown_atomic`) 커맨드 구현
- [x] 프론트엔드: Prettier standalone 마크다운 포매터 유틸리티 작성 (지연 로드, 파싱 에러 시 원본 보존 예외 처리 포함)
- [x] 문서 상태(`filePath`, `isDirty`) 관리 및 창 타이틀바 수정 표시(`•`) 동기화
- [x] 전역 단축키(`Cmd + O`, `Cmd + S`, `Cmd + Shift + S`, `Cmd + N`) 바인딩
- [x] 미저장 상태에서 창 닫기나 다른 파일 열기 시 경고 모달 방어 로직 구현

### 2단계: Milkdown 에디터 코어 교체 및 단방향 바인딩
`<textarea>`를 들어내고 Milkdown 에디터를 마운트하여 기본 위지윅 마크다운 편집을 구현한다.

상세 태스크: [`superpowers/plans/2026-10-19-phase2-milkdown-editor.md`](superpowers/plans/2026-10-19-phase2-milkdown-editor.md)

- [x] `@milkdown/kit`(`core`, `preset/commonmark`, `preset/gfm`, `plugin/history` 포함) 설치 및 초기 설정
- [x] 단방향 데이터 플로우 연결
  - 파일 열기: 읽어온 문자열로 에디터 인스턴스 초기화
  - 편집 중: 동기 ProseMirror 플러그인 뷰(`update`)로 문서 변경 시 `isDirty` 상태만 업데이트 (React 리렌더링 차단). listener 플러그인은 200ms 디바운스라 닫기 경고를 놓칠 수 있어 사용하지 않음
  - 파일 저장: `Cmd + S` 입력 시점에만 에디터에서 마크다운 문자열을 추출하여 LF 정규화와 끝 개행 보장 후 디스크에 기록 (타이핑 중 커서 튐 방지)
- [x] 한글 IME 조합 테스트 (제목, 굵게, 리스트 등 마크다운 Input Rule 변환 직후 한글 입력 시 자소 분리 여부 검증)
- [x] Prettier 제거 여부 판단: Milkdown `getMarkdown()` 출력(remark-stringify)이 충분히 일관되면 Prettier를 빼고 LF 정규화와 끝 개행만 남긴다 → 제거함(remark-stringify 출력이 결정적이고 Prettier와 충돌)
- 알려진 문제 (2단계, 직렬화 동작)
  - front matter는 편집 불가, 저장 시 원문 그대로 보존(shim)
  - `[[page]]` → `\[\[page]]` (위키 링크 이스케이프)
  - 참조 링크 `[x][r]`와 정의 → 인라인 링크로 변환
  - 맨 URL `https://example.com` → `<https://example.com>`
  - 줄 끝 공백 두 개 줄바꿈 `a  \nb` → `a\\\nb`
  - `a*b` → `a\*b` (`snake_case`는 유지)
  - 연속 빈 줄은 한 줄로 축소, 빈 문단은 `<br />`로 저장됨 (정책 미정)
  - 작업 목록 체크 상태가 화면에 표시되지 않음 → 3단계에서 해결

### 3단계: Typora 스타일 UI 및 확장 렌더링 고도화
마크다운 확장 문법을 붙이고 로컬 에셋 처리와 스타일을 다듬는다.

상세 태스크: [`superpowers/plans/2026-10-19-phase3-typora-ui.md`](superpowers/plans/2026-10-19-phase3-typora-ui.md)

- [x] GFM 렌더링 검증(표 편집, 체크박스 토글, 취소선, 각주). 프리셋 연동은 2단계에서 선행
- [x] `@milkdown/plugin-prism` 적용(Shiki는 번들 크기 때문에 제외)
- [x] 로컬 이미지 렌더링 및 붙여넣기 처리
  - 마크다운 내 상대 경로 이미지를 웹뷰에 띄우기 위해 Tauri `convertFileSrc` 및 Asset 프로토콜 스코프 설정(`$HOME/**`)
  - 에디터에 이미지 클립보드 붙여넣기 및 드래그 앤 드롭 시 현재 문서 하위 폴더(`./assets`)에 저장 후 상대 경로 삽입
  - 다른 폴더로 저장하면 상대 경로 이미지를 새 위치 기준(`../`)으로 다시 써서 원래 파일을 계속 가리킴
- [x] 본문 타이포그래피 스타일링 및 시스템 설정 연동 다크 모드 적용
- 알려진 문제 (3단계)
  - 저장하지 않은 문서에는 이미지를 붙여넣을 수 없음(안내 메시지). 임시 폴더 저장 정책 미정
  - `$HOME` 밖 문서의 이미지는 asset 스코프 때문에 표시되지 않음
  - 창에 `.md` 파일을 드롭해도 열리지 않음(`dragDropEnabled: false`, HTML5 드롭을 이미지 업로드에 사용)

### 4단계: macOS 네이티브 통합 및 패키징
실제 데스크탑 앱으로서의 사용성을 완성하고 배포용 번들을 생성한다.

상세 태스크: [`superpowers/plans/2026-10-20-phase4-native-packaging.md`](superpowers/plans/2026-10-20-phase4-native-packaging.md)

- [x] Finder 연동 (`fileAssociations` 설정으로 `.md` 파일 더블클릭 및 드래그 앤 드롭 시 앱으로 열기 처리)
- [x] 외부 프로그램에 의한 현재 열린 파일 변경 감지(File Watcher) 및 리로드 알림 (2초 mtime 폴링)
- [x] 최근 열었던 파일(Recent Files) 목록 관리 (File 메뉴 추가, 단축키는 메뉴 accelerator로 이동)
- [x] 성능 프로파일링 (콜드 스타트 속도, 유휴 메모리 100MB 이내, 대용량 문서 타이핑 지연 확인)
- [x] macOS `.app` 및 `.dmg` 프로덕션 빌드 테스트
- 측정 결과 (4단계, Apple Silicon, 릴리스 빌드)
  - 번들: `.app` 4.4MB(실행 파일 4.3MB), `.dmg` 2.2MB (목표 10MB 이하). JS 청크 816KB(gzip 254KB) 단일 파일
  - 콜드 스타트: 수동 측정 필요(비GUI 환경에서 창 생성 시점을 잡지 못함). 측정 스크립트는 4단계 계획 Task 4 Step 3
  - 유휴 메모리(빈 문서, 15초 대기, physical footprint): 메인 29.8MB + Web Content 33.5MB = 약 63MB (목표 100MB 이내). 대용량 문서(2.1MB, 10000절)는 수동 측정 필요
  - 타이핑 지연: 수동 측정 필요(Web Inspector 타임라인). 테스트 문서 `/tmp/mini-mark-large.md`
- 알려진 문제 (4단계)
  - 코드 서명과 공증 없음(ad-hoc 서명). 다른 머신에서는 `xattr -d com.apple.quarantine`가 필요하다
  - 여러 파일을 동시에 열면 첫 파일만 연다(단일 창)
  - 외부 변경은 2초 폴링으로 감지한다. 다시 불러오면 커서가 문서 처음으로 간다
  - Open Recent는 파일명만 표시해 같은 이름의 파일을 구분하지 못한다. 사라진 파일은 목록에서 자동으로 빠지지 않는다
  - 창에 `.md` 파일을 드롭해도 열리지 않음(3단계와 동일, Dock 아이콘 드롭은 동작)
