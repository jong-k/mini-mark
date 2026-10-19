# 커밋 메시지 컨벤션

> Udacity Nanodegree Commit Convention 참고

## 1. 커밋 메시지 구조

```
type(scope): subject
```

## 2. Type 규칙

- **feat**: 새로운 기능 추가
  - _예) feat(auth): 로그인 폼에 비밀번호 보기 토글 추가_
- **fix**: 버그 수정
  - _예) fix(header): 모바일 헤더 메뉴 터치 이벤트 누락 문제 수정_
- **docs**: 문서 변경, 주석 추가
  - _예) docs(readme): README에 로컬 실행 방법 및 환경 변수 세팅 추가_
- **style**: 코드 포맷/스타일 수정 (코드 로직 변경 없음)
  - _예) style(imports): eslint 규칙에 맞게 import 정렬_
- **refactor**: 리팩토링 (최종 기능 변화 없음), 리네이밍(가독성/컨벤션 고려)
  - _예) refactor(constants): defaultDirection 상수를 DEFAULT_DIRECTION으로 리네이밍_
- **test**: 테스트 추가/수정 (production 코드 로직 변경 없음)
  - _예) test(login): 로그인 플로우 E2E 테스트 추가_
- **chore**: 개발 도구/빌드/패키지 매니저 (production 코드 로직 변경 없음)
  - _예) chore(build): vite 빌드 옵션 조정 및 의존성 업데이트_

## 3. 세부 작성 가이드

- **제목(Subject):** 50자 이내로 작성한다. 명사형 어미나 `~함`, `~추가`, `~수정` 등으로 간결하게 끝낸다. 영어를 포함할 수 있지만 기본적으로 한국어로 작성한다.
- **스코프(Scope):** 변경된 도메인이나 컴포넌트 이름(예: auth, user, ui, config 등)을 괄호 안에 적는다. 스코프는 생략할 수 있다.
- **본문(Body):** 사용하지 않는다.
- **꼬리말(Footer):** 사용하지 않는다.