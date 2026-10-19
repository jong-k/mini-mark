import { useImperativeHandle, useRef } from "react";

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
        if (textareaRef.current) textareaRef.current.value = value;
      },
    }),
    [],
  );

  return <textarea ref={textareaRef} style={textareaStyle} onInput={onChange} />;
}
