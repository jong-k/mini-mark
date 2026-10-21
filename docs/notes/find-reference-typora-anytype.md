# 찾기 레퍼런스 분석: Typora와 Anytype

`docs/spec/find.md`의 배경 자료다. 바꾸기를 붙일 때 다시 본다.

- 작성일: 2026-10-21
- 대상: Typora 1.14.10, Anytype 0.57.4 (macOS)

## 관찰 방법

- 두 앱 모두 실행 중인 창의 스크린샷과 접근성 트리를 읽었다. 키 입력과 클릭은 하지 않았다.
- 동작 세부는 앱 번들에 든 JS, CSS, 로컬라이즈 문자열을 읽어 확인했다. 아래에서 "관찰"은 화면에서 본 것, "소스"는 코드에서 읽은 것이다.
- 주의: 접근성 값 쓰기로 입력란을 채우려다 Typora 본문 문단을 덮어쓴 적이 있다. 웹뷰 기반 앱은 읽기만 한다.

## Typora

### 화면 (관찰)

- 창 상단, 제목 표시줄 바로 아래 한 줄 바.
- 왼쪽부터 "찾기 ▾" 드롭다운(바꾸기 모드 전환), 입력란, 입력란 오른쪽 끝 안에 토글 3개(대/소문자 구분 `Aa`, 단어 단위로, 정규식 `(.*)`), 위아래 화살표, 개수 `1 / 2`, 닫기 X.

### 동작 (소스: `TypeMark/appsrc/window/frame.js`)

- 입력하면 즉시 검색한다. 디바운스 50ms, 바쁠 때 100ms. `compositionstart`부터 `compositionend`까지는 검색하지 않고 조합이 끝나면 100ms 뒤 검색한다.
- 입력란 Enter: 입력값이 마지막 검색어와 같으면 다음(Shift면 이전), 다르면 검색만 한다.
- Tab: 바꾸기 모드면 바꾸기 입력란으로 포커스, 아니면 탭 문자를 넣는다.
- Esc: 입력란과 body 어디서든 패널을 닫는다.
- 열 때: 이미 열려 있으면 입력란 포커스와 전체 선택만. 아니면 현재 커서 위치를 저장하고, 본문 선택 텍스트(또는 코드 블록의 CodeMirror 선택)가 있으면 입력란에 채운 뒤 바로 검색한다. 검색어는 패널을 닫아도 입력란에 남는다.
- 닫을 때: 현재 일치 요소(`.md-search-select`)를 본문 선택으로 만들고 본문에 포커스를 준다. 본문의 일치 항목(`.md-search-hit`)을 클릭해도 그 항목을 선택하며 닫힌다.
- 매칭: 정규식 옵션이 꺼져 있으면 검색어를 이스케이프한다. 단어 단위는 `\b`로 감싼다. 대소문자 옵션에 따라 `g` 또는 `gi`. 옵션 상태는 설정(`File.option`)에 저장한다.
- 개수: `현재+1 / 전체`. 없으면 "결과 없음"(빨강), 5000개 초과면 "5000+"에 "결과가 너무 많음" 툴팁.
- 바꾸기 모드: 드롭다운으로 전환하면 바꾸기 입력란과 "바꾸기", "모두 바꾸기" 버튼이 두 번째 행에 나온다. 모두 바꾸기 뒤에는 결과 메시지와 "실행 취소" 버튼이 5초간 보인다.

### 스타일 (소스: `TypeMark/style/*.css`)

- 모든 일치 `.md-search-hit`: 배경 `rgba(248, 192, 116, 0.3)`.
- 현재 일치 `.md-search-select`: 배경 `#000`, 글자 `#fff` (`--search-select-bg-color`, `--search-select-text-color`).
- 켜진 옵션 토글 `.searchpanel-search-option-btn.active`: 배경 `#ddd` (`--active-toggle-btn-color`).
- 브라우저가 지원하면 CSS Custom Highlight API(`search-hit`, `search-select`)를 쓰고, 아니면 요소를 감싼다.

### 메뉴와 문구

- Edit 메뉴 항목(`Base.lproj/Menu.strings`, `ko-KR.lproj/Menu.strings`): Find(찾기), Find Next(다음 찾기), Find Previous(이전 찾기), Replace(바꾸기), Find and Replace(찾기 및 바꾸기), Replace Next(다음 바꾸기). 단축키는 nib에 있어 확인하지 못했다. macOS 관례는 Cmd+F, Cmd+G, Cmd+Shift+G, Cmd+H다.
- 패널 문구(`TypeMark/locales/ko-KR.lproj/Front.json`): search text = 찾기, replace with = 바꾸기, Case Sensitive = 대/소문자 구분, Whole Word = 단어 단위로, No Results = 결과 없음, Too many matches = 결과가 너무 많음.

## Anytype

### 화면 (관찰)

- 페이지 헤더 위에 뜨는 바. 본문을 밀어내지 않는다.
- 알약형 영역 하나에 돋보기 아이콘, 입력란(자리 표시 "Search"), 개수 `1 of 97`, 원 안의 X 지우기 버튼. 옆의 작은 알약형 영역에 위아래 화살표. 옵션 토글은 없다.
- 모든 일치는 글자색만 강조색으로 바뀌고 현재 일치만 선택 배경이 깔린다.

### 동작 (소스: `app.asar` 안 `dist/js/main.js`의 `menuSearchText` 컴포넌트)

- 열기: 에디터에서 Cmd+F를 누르면 포커스된 블록의 선택 텍스트를 넘겨 연다. 헤더의 검색 버튼은 빈 값으로 연다. 메뉴는 헤더 중앙에 `position: fixed; top: 42px`로 뜨고 폭은 헤더 중앙 영역과 에디터 폭 중 작은 값이다. `passThrough`라 바 밖의 본문을 그대로 쓸 수 있다.
- 열린 직후 100ms 뒤에 넘겨받은 값 또는 저장된 이전 검색어를 입력란에 넣고 전체 선택, 포커스, 검색한다.
- 입력: 키를 뗀 뒤 500ms(`delay.keyboard`) 디바운스. Enter와 Tab은 즉시 검색하고 다음으로 이동. 위 화살표 이전, 아래 화살표 다음. 바가 열린 채 Cmd+F는 다음.
- 매칭: 검색어를 이스케이프한 `gi` 정규식으로 `findAndReplaceDOMText`(prose 프리셋)를 돌려 `markupsearch` 태그로 감싼다. 보이는 요소만 대상이고, 접힌 토글 안에 일치가 있으면 토글을 펼친다. 검색어는 메뉴 저장소에 남아 다음 열기 때 복원된다.
- 개수: 일치가 있을 때만 `현재+1 of 전체`. 없으면 비운다.
- 이동: 현재 일치에 `active` 클래스를 붙이고 블록 id와 범위를 기억한다. 스크롤은 컨테이너 `scrollTop`을 직접 계산한다. 순환한다. 본문 선택은 바꾸지 않는다.
- 닫기: 지우기 버튼은 입력란과 저장된 검색어를 비우고 닫는다. 언마운트 때 감싼 태그를 풀고, 펼친 토글을 되돌리고, 기억한 현재 일치 범위를 본문 선택으로 놓는다.
- 바꾸기: 없다.

### 스타일 (소스: `dist/css/style.css`)

- `markupsearch`: `color: var(--color-system-accent-100) !important; border-radius: 2px`.
- `markupsearch.active`: `background: var(--color-system-selection) !important`.
- `.filterContainer`: 높이 32px, 모서리 16px, 배경 `--color-shape-highlight-medium`, 테두리 1px `--color-shape-secondary`, 안쪽 여백 `0 12px`, 간격 6px.
- `.arrowWrapper`: 안쪽 여백 `6px 8px`, 모서리 16px, 간격 8px, 같은 배경. 아이콘 20px.
- `.cnt`(개수): 작은 글자, 색 `--color-control-active`, 좌우 여백 8px.

### 단축키와 문구

- 단축키 목록(`popupShortcutMainBasics9`): searchText = Cmd+F. Find Next, Find Previous에 해당하는 단축키는 없다.
- 문구(`dist/lib/json/lang/ko-KR.json`): commonSearch = 검색, commonNext = 다음.

## 소스 위치

- Typora: `/Applications/Typora.app/Contents/Resources/TypeMark/appsrc/window/frame.js`(압축됨, `searchpanel`로 검색), `TypeMark/style/`, `Base.lproj/Menu.strings`, `ko-KR.lproj/Menu.strings`, `TypeMark/locales/ko-KR.lproj/Front.json`.
- Anytype: `/Applications/Anytype.app/Contents/Resources/app.asar`. `npx @electron/asar extract-file app.asar dist/js/main.js`로 꺼내 `of ${`로 검색하면 컴포넌트가 나온다. CSS는 `dist/css/style.css`, 문구는 `dist/lib/json/lang/ko-KR.json`.
