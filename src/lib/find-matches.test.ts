import { Schema } from "@milkdown/kit/prose/model";
import { expect, it } from "vitest";
import { findMatches, initialIndex, wrapIndex } from "./find-matches";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    image: { inline: true, group: "inline" },
    hard_break: { inline: true, group: "inline" },
  },
});

const p = (...content: string[]) =>
  schema.node(
    "paragraph",
    null,
    content.map((c) => (c === "image" || c === "hard_break" ? schema.node(c) : schema.text(c))),
  );
const doc = (...paragraphs: ReturnType<typeof p>[]) => schema.node("doc", null, paragraphs);

it("finds every match ignoring case with document positions", () => {
  expect(findMatches(doc(p("Foo foo")), "foo")).toEqual([
    { from: 1, to: 4 },
    { from: 5, to: 8 },
  ]);
});

it("treats regex characters literally", () => {
  expect(findMatches(doc(p("axb a.b")), "a.b")).toEqual([{ from: 5, to: 8 }]);
});

it("keeps positions across inline leaf nodes", () => {
  expect(findMatches(doc(p("ab", "image", "ab")), "ab")).toEqual([
    { from: 1, to: 3 },
    { from: 4, to: 6 },
  ]);
  expect(findMatches(doc(p("ab", "hard_break", "ab")), "ab")).toEqual([
    { from: 1, to: 3 },
    { from: 4, to: 6 },
  ]);
});

it("does not match across blocks", () => {
  expect(findMatches(doc(p("ab"), p("cd")), "bc")).toEqual([]);
  expect(findMatches(doc(p("ab"), p("cd")), "cd")).toEqual([{ from: 5, to: 7 }]);
});

it("returns nothing for an empty query", () => {
  expect(findMatches(doc(p("foo")), "")).toEqual([]);
});

it("initialIndex picks the first match at or after the position", () => {
  const matches = [
    { from: 1, to: 3 },
    { from: 10, to: 12 },
  ];
  expect(initialIndex(matches, 5)).toBe(1);
  expect(initialIndex(matches, 11)).toBe(0);
  expect(initialIndex(matches, 0)).toBe(0);
  expect(initialIndex([], 0)).toBe(-1);
});

it("wrapIndex wraps at both ends", () => {
  expect(wrapIndex(3, 2, 1)).toBe(0);
  expect(wrapIndex(3, 0, -1)).toBe(2);
  expect(wrapIndex(3, 1, 1)).toBe(2);
  expect(wrapIndex(0, -1, 1)).toBe(-1);
});
