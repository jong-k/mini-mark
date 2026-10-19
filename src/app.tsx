import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { matchShortcut } from "./lib/document-shortcuts";
import { formatMarkdown } from "./lib/format-markdown";
import {
  confirmDiscard,
  onWindowCloseRequested,
  pickOpenPath,
  pickSavePath,
  readMarkdown,
  saveMarkdownAtomic,
  setWindowTitle,
  showError,
} from "./lib/tauri";
import { windowTitle } from "./lib/window-title";

export default function App() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const editor = useRef<EditorHandle>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      await showError(String(err));
    }
  }

  function newDocument() {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      if (isDirty && !(await confirmDiscard())) return;
      h.setFilePath(null);
      h.setValue("");
      setFilePath(null);
      setIsDirty(false);
    });
  }

  function openDocument() {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      if (isDirty && !(await confirmDiscard())) return;
      const path = await pickOpenPath();
      if (path === null) return;
      const content = await readMarkdown(path);
      h.setFilePath(path);
      h.setValue(content);
      setFilePath(path);
      setIsDirty(false);
    });
  }

  function saveDocument(path: string) {
    return run(async () => {
      const h = editor.current;
      if (!h) return;
      // 다른 폴더면 상대 경로 이미지를 새 위치 기준으로 다시 쓴다. getValue보다 먼저 불러야 한다.
      h.setFilePath(path);
      const source = h.getValue();
      try {
        await saveMarkdownAtomic(path, formatMarkdown(source));
      } catch (err) {
        h.setFilePath(filePath);
        throw err;
      }
      setFilePath(path);
      if (h.getValue() !== source) return;
      setIsDirty(false);
    });
  }

  async function saveAs() {
    const path = await pickSavePath(filePath ?? "Untitled.md").catch(async (err) => {
      await showError(String(err));
      return null;
    });
    if (path === null) return;
    await saveDocument(path);
  }

  async function save() {
    if (filePath) await saveDocument(filePath);
    else await saveAs();
  }

  useEffect(() => {
    setWindowTitle(windowTitle(filePath, isDirty));
  }, [filePath, isDirty]);

  const actions = useRef({ new: newDocument, open: openDocument, save, saveAs });
  actions.current = { new: newDocument, open: openDocument, save, saveAs };

  const busy = useRef(false);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    // ponytail: 버리기/취소 2버튼. 저장/버리기/취소 3버튼이 필요하면 커스텀 모달로 교체.
    const unlisten = onWindowCloseRequested(
      async () => !isDirtyRef.current || (await confirmDiscard()),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    // 저장 중 Cmd+N/Cmd+O가 끼어들면 새 문서가 이전 경로에 묶인다. 진행 중인 동작이 끝날 때까지 단축키를 무시한다.
    async function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e);
      if (action === null) return;
      e.preventDefault();
      if (busy.current) return;
      busy.current = true;
      try {
        await actions.current[action]();
      } finally {
        busy.current = false;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <Editor handleRef={editor} onChange={() => setIsDirty(true)} />;
}
