// 에디터 밖에 파일을 떨어뜨리면 WKWebView가 그 파일로 이동해 문서가 사라진다.
// Tauri 네이티브 드롭 핸들러(dragDropEnabled)를 껐으므로 직접 막는다. 에디터 안 드롭은 ProseMirror가 먼저 처리한다.
export function blockFileDrop(event: {
  dataTransfer: { types: readonly string[] } | null;
  preventDefault(): void;
}): void {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
}
