# このリポジトリでの作業

- `.env` および `.env` で始まる環境設定ファイルは、読み書きしない。内容の表示や検索対象への追加もしない。
- このアプリは、Next.js 16、React 19、AI SDK 7 を使った個人向けの Grok Council。機能と設定の概要は `README.md` を参照する。
- 変更する箇所に応じて、画面は `src/components/council/`、API は `src/app/api/council/route.ts`、討論の処理は `src/lib/`、人物や上限の設定は `src/config/` を確認する。
- 変更後は影響範囲に応じて `npm run lint` と `npm run build` で確認し、実行できなかった確認や残る問題を報告する。
- 新しい依存関係を追加する前に、既存の依存関係で実現できるか確認する。
- この Next.js には破壊的な変更があり、API、慣習、ファイル構成が学習済みの知識と異なる可能性がある。コードを書く前に、対象に関係する `node_modules/next/dist/docs/` 内のガイドを読み、非推奨の注意書きにも従う（下の英語ブロックと同じ内容）。
- 下の `nextjs-agent-rules` ブロックは `next dev` が管理する英語の定型文なので、編集・翻訳しない。AI エージェントの環境で `next dev` を起動すると、定型文と一致しないブロックは英語で上書きされる（`node_modules/next/dist/server/lib/app-info-log.js` の `ensureAgentRulesForDev`）。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
