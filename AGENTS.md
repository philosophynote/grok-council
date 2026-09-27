# このリポジトリでの作業

- `.env` および `.env` で始まる環境設定ファイルは、読み書きしない。内容の表示や検索対象への追加もしない。
- このアプリは、Next.js 16、React 19、AI SDK 7 を使った個人向けの Grok Council。機能と設定の概要は `README.md` を参照する。
- 変更する箇所に応じて、画面は `src/components/council/`、API は `src/app/api/council/route.ts`、討論の処理は `src/lib/`、人物や上限の設定は `src/config/` を確認する。
- 変更後は影響範囲に応じて `npm run lint` と `npm run build` で確認し、実行できなかった確認や残る問題を報告する。
- 新しい依存関係を追加する前に、既存の依存関係で実現できるか確認する。

<!-- BEGIN:nextjs-agent-rules -->

# この Next.js は既知の仕様を前提にしない

このバージョンには破壊的な変更があり、API、慣習、ファイル構成が学習済みの知識と異なる可能性がある。コードを書く前に、対象に関係する `node_modules/next/dist/docs/` 内のガイドを読む。このパスはこのファイルのディレクトリを基準に解決する。モノレポではリポジトリのルートから `next` パッケージが見えない場合がある。非推奨の注意書きにも従う。

このブロックは `next dev` が生成・再追加する。生成処理は `node_modules/next/dist/server/lib/generate-agent-files.js` で確認できる。現在の生成処理は英語の定型文でこのブロックを上書きするため、`next dev` の実行後は日本語訳が維持されているか確認する。

<!-- END:nextjs-agent-rules -->
