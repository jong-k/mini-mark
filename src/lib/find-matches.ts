import type { Node } from "@milkdown/kit/prose/model";

export interface Match {
  from: number;
  to: number;
}

// 리프 노드(이미지, 줄바꿈)는 문서 위치 한 칸을 차지한다. 한 글자로 바꿔 넣어 오프셋을 맞춘다.
const LEAF = "￼";

/** 텍스트 블록 안에서 대소문자 무시 리터럴로 찾는다. 빈 검색어면 []. 블록 경계를 넘지 않는다. */
export function findMatches(doc: Node, query: string): Match[] {
  if (query === "") return [];
  const regexp = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, LEAF);
    for (const m of text.matchAll(regexp)) {
      matches.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return matches;
}

/** pos 이상에서 시작하는 첫 일치의 인덱스. 없으면 0. matches가 비면 -1. */
export function initialIndex(matches: Match[], pos: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((m) => m.from >= pos);
  return index < 0 ? 0 : index;
}

/** 순환하는 다음 인덱스. count가 0이면 -1. */
export function wrapIndex(count: number, current: number, delta: 1 | -1): number {
  if (count === 0) return -1;
  return (current + delta + count) % count;
}
