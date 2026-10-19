const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function imageFilePath(src: string, documentPath: string | null): string | null {
  if (src === "" || SCHEME.test(src)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    decoded = src; // `100%.png`처럼 인코딩되지 않은 원문 파일명
  }
  if (decoded.startsWith("/")) return decoded;
  if (documentPath === null) return null;
  const parts = documentPath.split("/").slice(0, -1);
  for (const seg of decoded.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

export function relativeImageSrc(absolutePath: string, documentPath: string): string {
  const from = documentPath.split("/").slice(1, -1);
  const to = absolutePath.split("/").slice(1);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  return rel.replace(/[ %#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function assetFileName(name: string, type: string, now: Date): string {
  // 마크다운 URL에서 인코딩이 필요한 문자를 파일명에서 미리 없앤다.
  const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot + 1) : (EXT_BY_MIME[type] ?? "png");
  if (stem !== "" && stem !== "image") return `${stem}.${ext}`;
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `image-${stamp}.${ext}`;
}
