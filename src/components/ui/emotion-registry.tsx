"use client";

import createCache, { type EmotionCache } from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { useState } from "react";

/**
 * Emotion のスタイルを SSR 時に <style> として本文へ直接埋め込まず、
 * Next.js の useServerInsertedHTML 経由で流すためのレジストリ。
 *
 * 既定の挙動（本文への埋め込み）だと、next-themes が同じ位置に描画する <script> と
 * 順序が食い違い、hydration エラーになる。
 * 参考: node_modules/next/dist/docs/01-app/02-guides/css-in-js.md
 */
export function EmotionRegistry({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => {
    const cache: EmotionCache = createCache({ key: "css" });
    // compat を立てると、サーバー側では cache.inserted に CSS 文字列が溜まるだけで
    // インラインの <style> は描画されなくなる
    cache.compat = true;

    const prevInsert = cache.insert;
    let inserted: string[] = [];
    cache.insert = (...args) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name);
      }
      return prevInsert(...args);
    };
    const flush = () => {
      const prev = inserted;
      inserted = [];
      return prev;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = registry.flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) {
      const rules = registry.cache.inserted[name];
      if (typeof rules === "string") styles += rules;
    }
    return (
      <style
        data-emotion={`${registry.cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}
