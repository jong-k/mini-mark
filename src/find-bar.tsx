import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FindHandle, FindState } from "./editor";
import { onFindAction } from "./lib/tauri";

const DEBOUNCE_MS = 100;
const ICON = { size: 16, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * 찾기 바. 스펙은 docs/spec/find.md.
 * 열림, 검색어, 개수는 여기 React 상태다. 매칭과 표시는 `find` 핸들 뒤의 에디터가 맡고 `App`은 찾기를 모른다.
 */
export function FindBar({ find }: { find: FindHandle }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<FindState>({ query: "", count: 0, current: -1 });
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const composing = useRef(false);
  // 마지막으로 find.search에 보낸 검색어. Enter가 검색과 이동 중 무엇을 할지 가른다.
  const searched = useRef("");
  // 이벤트 리스너는 마운트 때 한 번 등록된다. 최신값은 ref로 읽는다.
  const latest = useRef({ open, query });
  useLayoutEffect(() => {
    latest.current = { open, query };
  });

  const cancel = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  const runSearch = (q: string) => {
    cancel();
    searched.current = q;
    find.search(q);
  };
  const schedule = (q: string) => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      runSearch(q);
    }, DEBOUNCE_MS);
  };
  const focusInput = () => {
    input.current?.focus();
    input.current?.select();
  };
  // 검색어가 마지막 검색과 다르면 검색만 한다. 한글 조합을 확정하는 Enter가 한 칸 건너뛰지 않게 하기 위해서다.
  const move = (delta: 1 | -1) => {
    if (query !== searched.current) {
      runSearch(query);
      return;
    }
    cancel();
    find.step(delta);
  };
  // 선택 텍스트 가져오기는 Cmd+F 경로에만 있다. 닫힌 상태의 Cmd+G는 이전 검색어로 연다.
  const openBar = (prefill: boolean) => {
    if (latest.current.open) {
      focusInput();
      return;
    }
    let q = latest.current.query;
    if (prefill) {
      const selected = find.selectionText();
      if (selected !== "") q = selected;
    }
    setQuery(q);
    setOpen(true);
    if (q !== "") runSearch(q);
  };
  const closeBar = () => {
    cancel();
    setOpen(false);
    find.close();
  };

  useEffect(() => {
    const unsubscribe = find.onChange(setState);
    const listening = onFindAction((action) => {
      if (action === "find") {
        openBar(true);
        return;
      }
      const delta = action === "findNext" ? 1 : -1;
      if (!latest.current.open) {
        openBar(false);
        if (latest.current.query === "") return;
      }
      find.step(delta);
    });
    // 본문에 포커스가 있을 때도 Esc로 닫는다. 입력란의 Esc도 여기까지 올라온다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && latest.current.open) closeBar();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unsubscribe();
      void listening.then((fn) => fn());
      window.removeEventListener("keydown", onKey);
      cancel();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- 핸들러는 ref와 setter, find만 쓴다. 마운트 때 한 번 등록한다.
  }, [find]);

  useEffect(() => {
    if (open) focusInput();
  }, [open]);

  if (!open) return null;

  const countText =
    state.query === ""
      ? ""
      : state.count === 0
        ? "결과 없음"
        : `${state.current + 1} / ${state.count}`;
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="find-bar" role="search">
      <div className="find-field">
        <Search {...ICON} />
        <input
          ref={input}
          value={query}
          placeholder="찾기"
          aria-label="찾기"
          spellCheck={false}
          onChange={(event) => {
            const q = event.target.value;
            setQuery(q);
            if (!composing.current) schedule(q);
          }}
          onKeyDown={(event) => {
            // React의 KeyboardEvent 타입에는 isComposing이 없다.
            if (event.nativeEvent.isComposing) return;
            const delta =
              event.key === "Enter"
                ? event.shiftKey
                  ? -1
                  : 1
                : event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : null;
            if (delta === null) return;
            event.preventDefault();
            move(delta);
          }}
          onCompositionStart={() => {
            // 입력 뒤 100ms 안에 조합을 시작하면 예약된 검색이 조합 중에 돈다. 취소한다.
            cancel();
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            schedule(event.currentTarget.value);
          }}
        />
        <span className={state.count === 0 ? "find-count empty" : "find-count"} aria-live="polite">
          {countText}
        </span>
        <button
          type="button"
          aria-label="찾기 닫기"
          onClick={() => {
            setQuery("");
            closeBar();
          }}
        >
          <X {...ICON} />
        </button>
      </div>
      <div className="find-arrows">
        <button
          type="button"
          aria-label="이전 일치"
          onMouseDown={keepFocus}
          onClick={() => move(-1)}
        >
          <ChevronUp {...ICON} />
        </button>
        <button
          type="button"
          aria-label="다음 일치"
          onMouseDown={keepFocus}
          onClick={() => move(1)}
        >
          <ChevronDown {...ICON} />
        </button>
      </div>
    </div>
  );
}
