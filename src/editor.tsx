import { useImperativeHandle, useRef } from "react";

/**
 * 에디터 본문 접근 인터페이스.
 * `setValue`는 `onChange`를 발생시키지 않아야 한다. 핸들은 에디터가 마운트되기 전까지 `null`이다.
 */
export interface EditorHandle {
  getValue(): string;
  setValue(value: string): void;
}

const textareaStyle = {
  width: "100%",
  height: "100vh",
  resize: "none",
  border: 0,
  font: "14px/1.6 monospace",
  padding: 16,
  boxSizing: "border-box",
} as const;

export function Editor({
  handleRef,
  onChange,
}: {
  handleRef: React.RefObject<EditorHandle | null>;
  onChange: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      getValue: () => textareaRef.current?.value ?? "",
      setValue: (value: string) => {
        const ta = textareaRef.current;
        if (!ta) return;
        const { selectionStart, selectionEnd, scrollTop } = ta;
        ta.value = value;
        ta.setSelectionRange(
          Math.min(selectionStart, value.length),
          Math.min(selectionEnd, value.length),
        );
        ta.scrollTop = scrollTop;
      },
    }),
    [],
  );

  return (
    <textarea
      ref={textareaRef}
      style={textareaStyle}
      onInput={onChange}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
    />
  );
}
