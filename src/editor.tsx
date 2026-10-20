import { useEffect, useRef } from "react";
import { showError } from "./lib/tauri";
import { createMarkdownEditor, editorHandle } from "./markdown-editor";

/**
 * 에디터 본문 접근 인터페이스.
 * `setValue`는 `onChange`를 발생시키지 않아야 한다. 핸들은 Milkdown 생성이 끝나기 전까지 `null`이다.
 * `setFilePath`는 붙여넣은 이미지의 저장 위치와 `getValue`가 상대 경로를 계산할 기준 파일을 정한다. `setValue`보다 먼저 호출한다.
 * 본문은 불러온 폴더 기준 경로를 유지하므로 `setFilePath`는 `onChange`를 발생시키지 않는다.
 */
export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
  setFilePath(path: string | null): void;
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
  // app.tsx가 매 렌더마다 새 onChange를 넘긴다. 이펙트 의존성에 넣으면 에디터가 재생성되어 본문이 사라진다.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    let handle: EditorHandle | null = null;
    const creating = createMarkdownEditor(rootRef.current!, () => onChangeRef.current());
    creating.then((e) => {
      if (cancelled) return e.destroy();
      handle = handleRef.current = editorHandle(e);
      onReadyRef.current();
    }).catch((err) => void showError(String(err)));
    return () => {
      cancelled = true;
      void creating.then((e) => {
        if (handle === null) return; // 생성 완료 전 취소: 위 then이 이미 destroy했다
        if (handleRef.current === handle) handleRef.current = null;
        return e.destroy();
      }).catch(() => {}); // 생성 실패는 위에서 이미 표시했다
    };
  }, []);

  return <div ref={rootRef} />;
}
