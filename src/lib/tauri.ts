import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }];

/** File 메뉴 항목 id와 같다. Rust `menu.rs`가 그대로 emit한다. */
export type DocumentAction = "new" | "open" | "save" | "saveAs";

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

/** 콜드 스타트 때 Finder가 넘긴 파일 경로. 한 번 부르면 이후 요청은 `onOpenFileRequested`로만 온다. */
export function takeOpenedFile(): Promise<string | null> {
  return invoke<string | null>("take_opened_file");
}

export function onOpenFileRequested(handler: (path: string) => void): Promise<() => void> {
  return listen<string>("open-file", (event) => handler(event.payload));
}

export function onDocumentAction(handler: (action: DocumentAction) => void): Promise<() => void> {
  return listen<DocumentAction>("document-action", (event) => handler(event.payload));
}

export function addRecentFile(path: string): Promise<void> {
  return invoke<void>("add_recent_file", { path });
}

export function pickOpenPath(): Promise<string | null> {
  return open({ multiple: false, directory: false, filters: MARKDOWN_FILTERS });
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
  return getCurrentWindow().setTitle(title);
}

export function onWindowCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
}
