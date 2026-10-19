import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Editor, type EditorHandle } from "./editor";
import { matchShortcut } from "./lib/document-shortcuts";
import { formatMarkdown } from "./lib/format-markdown";
import {
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
    editor.current?.setValue("");
    setFilePath(null);
    setIsDirty(false);
  }

  function openDocument() {
    return run(async () => {
      const path = await pickOpenPath();
      if (path === null) return;
      const content = await readMarkdown(path);
      editor.current?.setValue(content);
      setFilePath(path);
      setIsDirty(false);
    });
  }

  function saveDocument(path: string) {
    return run(async () => {
      const source = editor.current?.getValue() ?? "";
      const formatted = await formatMarkdown(source);
      await saveMarkdownAtomic(path, formatted);
      if (formatted !== source) editor.current?.setValue(formatted);
      setFilePath(path);
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = matchShortcut(e);
      if (action === null) return;
      e.preventDefault();
      void actions.current[action]();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <Editor handleRef={editor} onChange={() => setIsDirty(true)} />;
}
