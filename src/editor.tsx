import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FindBar } from "./find-bar";
import { showError } from "./lib/tauri";
import { createMarkdownEditor, editorHandle } from "./markdown-editor";

/**
 * 에디터 본문 접근 인터페이스.
 * `setValue`는 `onChange`를 발생시키지 않아야 한다. 핸들은 Milkdown 생성이 끝나기 전까지 `null`이다.
 * `setFilePath`는 붙여넣은 이미지의 저장 위치와 `getValue`가 상대 경로를 계산할 기준 파일을 정한다. `setValue`보다 먼저 호출한다.
 * 본문은 불러온 폴더 기준 경로를 유지하므로 `setFilePath`는 `onChange`를 발생시키지 않는다.
 * `find`는 찾기 바가 쓰는 핸들이다. 표시만 바꾸고 문서는 바꾸지 않는다.
 */
export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  setFilePath(path: string | null): void;
  find: FindHandle;
}

export interface FindState {
  query: string;
  count: number;
  /** 0부터 센다. 일치가 없으면 -1. */
  current: number;
}

/** 찾기. 문서를 바꾸지 않고 표시만 바꾼다. 스펙은 docs/spec/find.md. */
export interface FindHandle {
  /** 검색어를 바꾸고 커서 이후 첫 일치를 현재로 삼는다. 빈 문자열이면 표시를 지운다. */
  search(query: string): void;
  step(delta: 1 | -1): void;
  /** 표시를 지우고, 현재 일치가 있으면 그 범위를 선택한 채 본문에 포커스를 준다. */
  close(): void;
  /** 본문 선택 텍스트. 없거나 줄바꿈이 있으면 빈 문자열. */
  selectionText(): string;
  /** 상태가 바뀔 때마다 부른다. 해제 함수를 돌려준다. */
  onChange(listener: (state: FindState) => void): () => void;
}

export function Editor({
  handleRef,
  onChange,
  onReady,
}: {
  handleRef: React.RefObject<EditorHandle | null>;
  onChange: () => void;
  /** `handleRef.current`가 채워진 직후 한 번 호출된다. */
  onReady: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 찾기 바는 핸들이 생긴 뒤에만 렌더한다. 생성 직후 한 번만 다시 렌더하고 타이핑 중에는 렌더가 없다.
  const [find, setFind] = useState<FindHandle | null>(null);
  // app.tsx가 매 렌더마다 새 onChange를 넘긴다. 이펙트 의존성에 넣으면 에디터가 재생성되어 본문이 사라진다.
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;
    let handle: EditorHandle | null = null;
    const creating = createMarkdownEditor(rootRef.current!, () => onChangeRef.current());
    creating
      .then((e) => {
        if (cancelled) return e.destroy();
        handle = handleRef.current = editorHandle(e);
        setFind(handle.find);
        onReadyRef.current();
      })
      .catch((err) => void showError(String(err)));
    return () => {
      cancelled = true;
      setFind(null);
      void creating
        .then((e) => {
          if (handle === null) return; // 생성 완료 전 취소: 위 then이 이미 destroy했다
          if (handleRef.current === handle) handleRef.current = null;
          return e.destroy();
        })
        .catch(() => {}); // 생성 실패는 위에서 이미 표시했다
    };
  }, [handleRef]);

  return (
    <>
      <div ref={rootRef} />
      {find && <FindBar find={find} />}
    </>
  );
}
