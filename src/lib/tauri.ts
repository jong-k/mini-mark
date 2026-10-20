import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md", "markdown"] }];

export function readMarkdown(path: string): Promise<string> {
  return invoke<string>("read_markdown", { path });
}

export function saveMarkdownAtomic(path: string, content: string): Promise<void> {
  return invoke<void>("save_markdown_atomic", { path, content });
}

// ponytail: number[]는 JSON으로 직렬화된다. 큰 이미지가 느리면 Uint8Array raw body와 헤더로 교체.
export function saveAsset(dir: string, fileName: string, data: number[]): Promise<string> {
  return invoke<string>("save_asset", { dir, fileName, data });
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

export function pickOpenPath(): Promise<string | null> {
  return open({ multiple: false, directory: false, filters: MARKDOWN_FILTERS });
}

export function pickSavePath(defaultPath?: string): Promise<string | null> {
  return save({ defaultPath, filters: MARKDOWN_FILTERS });
}

export function confirmDiscard(): Promise<boolean> {
  return ask("저장하지 않은 변경 사항이 있습니다. 버리시겠습니까?", {
    title: "mini-mark",
    kind: "warning",
    okLabel: "버리기",
    cancelLabel: "취소",
  });
}

export function confirmReload(): Promise<boolean> {
  return ask("디스크의 파일이 바뀌었습니다. 다시 불러오면 편집 중인 내용이 사라집니다.", {
    title: "mini-mark",
    kind: "warning",
    okLabel: "다시 불러오기",
    cancelLabel: "유지",
  });
}

export async function showError(text: string): Promise<void> {
  await message(text, { title: "mini-mark", kind: "error" });
}

export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}

export function onWindowCloseRequested(
  handler: () => Promise<boolean>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await handler())) event.preventDefault();
  });
}
