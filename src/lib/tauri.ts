import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ask, message, save } from "@tauri-apps/plugin-dialog";

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }];

/** File 메뉴 항목 id와 같다. Rust `menu.rs`가 앞 창에만 emit_to한다. New와 Open은 Rust가 처리한다. */
export type DocumentAction = "save" | "saveAs";

export function readMarkdown(path: string): Promise<string> {
  return invoke<string>("read_markdown", { path });
}

/** 저장된 파일의 mtime(ms)을 돌려준다. 외부 변경 감시 기준값으로 쓴다. */
export function saveMarkdownAtomic(path: string, content: string): Promise<number> {
  return invoke<number>("save_markdown_atomic", { path, content });
}

export function saveAsset(dir: string, fileName: string, data: Uint8Array): Promise<string> {
  // 바이트는 JSON을 거치지 않는 raw body로 보낸다. 헤더는 ASCII만 허용하므로 경로와 파일명은 percent 인코딩한다.
  return invoke<string>("save_asset", data, {
    headers: { dir: encodeURIComponent(dir), "file-name": encodeURIComponent(fileName) },
  });
}

export function assetUrl(path: string): string {
  return convertFileSrc(path);
}

export function fileModifiedAt(path: string): Promise<number> {
  return invoke<number>("file_modified_at", { path });
}

/** 이 창에 보류된 경로. 콜드 스타트의 Finder 인자나 새 창에 열 파일이다. 한 번 부르면 이후 요청은 `onOpenFileRequested`로만 온다. */
export function takeOpenedFile(): Promise<string | null> {
  return invoke<string | null>("take_opened_file");
}

/** 이 창의 문서 상태를 Rust에 보고한다. 빈 창 판단과 같은 파일 재열기에 쓴다. */
export function reportDocumentState(path: string | null, dirty: boolean): Promise<void> {
  return invoke<void>("set_document_state", { path, dirty });
}

/** 닫기 확인을 취소했을 때 부른다. Cmd+Q 진행 중이면 종료를 멈춘다. */
export function cancelQuit(): Promise<void> {
  return invoke<void>("cancel_quit");
}

// 전역 listen은 모든 창이 받는다. 이 창을 겨냥한 emit_to만 받도록 창의 listen을 쓴다.
export function onOpenFileRequested(handler: (path: string) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<string>("open-file", (event) => handler(event.payload));
}

export function onDocumentAction(handler: (action: DocumentAction) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<DocumentAction>("document-action", (event) =>
    handler(event.payload),
  );
}

/** Edit 메뉴 찾기 항목 id와 같다. Rust `menu.rs`가 그대로 emit한다. */
export type FindAction = "find" | "findNext" | "findPrev";

export function onFindAction(handler: (action: FindAction) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<FindAction>("find-action", (event) =>
    handler(event.payload),
  );
}

export function addRecentFile(path: string): Promise<void> {
  return invoke<void>("add_recent_file", { path });
}

export function pickSavePath(defaultPath?: string): Promise<string | null> {
  return save({ defaultPath, filters: MARKDOWN_FILTERS });
}

export function confirmDiscard(): Promise<boolean> {
  return ask("저장하지 않은 변경 사항이 있습니다. 버리시겠습니까?", {
    title: "Mini Mark",
    kind: "warning",
    okLabel: "버리기",
    cancelLabel: "취소",
  });
}

export function confirmReload(): Promise<boolean> {
  return ask("디스크의 파일이 바뀌었습니다. 다시 불러오면 편집 중인 내용이 사라집니다.", {
    title: "Mini Mark",
    kind: "warning",
    okLabel: "다시 불러오기",
    cancelLabel: "유지",
  });
}

export function confirmOverwrite(): Promise<boolean> {
  return ask("디스크의 파일이 바뀌었습니다. 저장하면 다른 프로그램의 수정이 사라집니다.", {
    title: "Mini Mark",
    kind: "warning",
    okLabel: "덮어쓰기",
    cancelLabel: "취소",
  });
}

export async function showError(text: string): Promise<void> {
  await message(text, { title: "Mini Mark", kind: "error" });
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWebviewWindow().setTitle(title);
}

export function onWindowCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  return getCurrentWebviewWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
}
