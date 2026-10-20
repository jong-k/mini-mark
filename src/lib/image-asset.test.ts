import { expect, it } from "vitest";
import { assetFileName, localFilePath, relativeLocalSrc } from "./image-asset";

it.each([
  ["assets/a.png", "/docs/n.md", "/docs/assets/a.png"],
  ["./a.png", "/docs/n.md", "/docs/a.png"],
  ["../img/a.png", "/docs/sub/n.md", "/docs/img/a.png"],
  ["../../a.png", "/n.md", "/a.png"],
  ["my%20pic.png", "/docs/n.md", "/docs/my pic.png"],
  ["chart%231.png", "/docs/n.md", "/docs/chart#1.png"],
  ["100%.png", "/docs/n.md", "/docs/100%.png"],
  ["/abs/a.png", "/docs/n.md", "/abs/a.png"],
  ["/abs/a.png", null, "/abs/a.png"],
  ["https://example.com/a.png", "/docs/n.md", null],
  ["data:image/png;base64,AAAA", "/docs/n.md", null],
  ["a.png", null, null],
  ["", "/docs/n.md", null],
])("imageFilePath(%j, %j) = %j", (src, doc, expected) => {
  expect(localFilePath(src, doc)).toBe(expected);
});

it.each([
  ["/a/assets/p.png", "/a/n.md", "assets/p.png"],
  ["/a/assets/p.png", "/b/n.md", "../a/assets/p.png"],
  ["/a/sub/p.png", "/a/sub/deep/n.md", "../p.png"],
  ["/a/my pic.png", "/b/n.md", "../a/my%20pic.png"],
  ["/a/chart#1.png", "/a/n.md", "chart%231.png"],
  ["/a/100%.png", "/a/n.md", "100%25.png"],
])("relativeImageSrc(%j, %j) = %j", (abs, doc, expected) => {
  expect(relativeLocalSrc(abs, doc)).toBe(expected);
  expect(localFilePath(expected, doc)).toBe(abs);
});

const now = new Date(2026, 9, 19, 15, 30, 12);

it.each([
  ["image.png", "image/png", "image-20261019-153012.png"],
  ["", "image/jpeg", "image-20261019-153012.jpg"],
  ["photo.JPG", "image/jpeg", "photo.JPG"],
  ["blob", "image/webp", "blob.webp"],
  ["100%.png", "image/png", "100-.png"],
  ["chart#1.png", "image/png", "chart-1.png"],
  ["내 사진.png", "image/png", "내-사진.png"],
])("assetFileName(%j, %j) = %j", (name, type, expected) => {
  expect(assetFileName(name, type, now)).toBe(expected);
});
