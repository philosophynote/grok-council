# 引き継ぎ: grok-council の実装を続けてください

## 何を作っているか

Grok (xAI) API で著名人に悩み相談し、著名人同士が討論して司会が総括する Web アプリ。
承認済みのプランが `/Users/naokitakahashi/.claude/plans/grok-api-aisdk-flickering-harbor.md` にあります。
**まずこのプランを読んでから作業してください。** 設計判断とその理由はすべてそこに書いてあります。

技術: Next.js 16 (App Router, src/) / React 19 / AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/xai`) / Chakra UI v3 / zod 4 / npm

## 今どこまでできているか

`/Users/naokitakahashi/develop/grok-council` に scaffold 済み、依存インストール済み。`npx tsc --noEmit` はサーバー側コードについて通っています。

作成済み（すべて完成、型チェック済み）:
- `src/config/council.ts` … モデル ID (`grok-4.3`)、reasoningEffort、上限値、timeout、throttle 間隔
- `src/config/moderator.ts` … 司会役のプロンプト
- `src/config/personas.ts` … 利用者が編集する著名人設定。ダミー 4 名入り
- `src/lib/types.ts` … `Persona`, `Speech`, `CouncilError`, `CouncilUIMessage = UIMessage<never, {speech, error}>`
- `src/lib/prompts.ts` … system / turn プロンプト生成、発言録の整形
- `src/lib/validate.ts` … zod + `safeValidateUIMessages` による検証、履歴復元
- `src/lib/council.ts` … `runCouncil()`: answer → debate × rounds → summary を直列実行。`fullStream` を回して text-delta / error / abort を処理。40ms throttle、AbortSignal.any による timeout、ターン境界の abort 確認、失敗しても次ターンへ進む
- `src/app/api/council/route.ts` … POST。400 は JSON、それ以外は `createUIMessageStreamResponse`
- `src/components/ui/provider.tsx`, `color-mode.tsx` … Chakra CLI snippet が生成（react-icons も入っている）

## 残っている作業（この順で）

1. **UI を書く**（未着手。scaffold 時の `src/app/page.tsx`, `layout.tsx`, `globals.css`, `page.module.css` はまだテンプレのまま）
   - `src/app/layout.tsx` … `lang="ja"`, `suppressHydrationWarning`, `<Provider>` でラップ。`LayoutProps` はグローバル型が未生成なので `{ children: React.ReactNode }` を使う。`globals.css` / `page.module.css` は削除してよい
   - `src/app/page.tsx` … `<Council />` を置くだけ
   - `src/components/council/Council.tsx`（client）… `useChat<CouncilUIMessage>({ transport: useMemo(() => new DefaultChatTransport({ api: "/api/council" }), []) })`。`sendMessage({ text }, { body: { personaIds, rounds } })`。参加者選択は初回送信後にロック。追加質問の有効化条件と Timeline のグルーピング方針はプラン参照
   - `PersonaPicker.tsx`（Checkbox.Root / NativeSelect）、`ConsultForm.tsx`（Textarea、送信・停止、連打防止、2,000 字カウンタ）、`Timeline.tsx`（メッセージ単位で走査、assistant 内でだけ phase/round 見出し）、`SpeechBubble.tsx`（Avatar.Fallback、考え中スピナー、中断バッジ）、`ErrorNotice.tsx`（Alert。useChat の `error.message` は 400 の JSON 文字列なので parse して message を出す）
   - Chakra v3 は compound 形式（`Checkbox.Root/HiddenInput/Control/Label`, `NativeSelect.Root/Field/Indicator`, `Alert.Root/Indicator/Content/Title/Description`, `Avatar.Root/Fallback`）。このプロジェクトには `chakra-ui` MCP サーバーが登録されているので、API に迷ったらそれで確認する
2. **README.md** を書き直す（テンプレのまま）: 環境変数 `XAI_API_KEY` の設定手順（ローカルの env ファイルに書く）、任意の `GROK_MODEL` / `GROK_REASONING_EFFORT`、著名人の追加方法、履歴はクライアント再送のため信頼できない旨、`maxDuration` の注意、17 回呼び出し時の所要時間目安
3. `npm run lint` と `npm run build` を通す
4. `npm run dev` で動作確認。プラン末尾の検証表に沿う。xAI への実呼び出しが要るケースは、ユーザーが API キーを置いた後に実施する

## 追加済み: 回答者の自動選定（2026-09-19）

「相談内容に合わせて自動で選ぶ」スイッチをオンにすると、初回送信時にサーバーが Vercel AI Gateway の評価モデル
（`typesafe-ai/jev`、`experimental_evaluate`）で全著名人の適性を採点し、上位 N 名を参加者にする。

- `src/lib/routing.ts` … `routePersonas()`。候補 1 名 = score 質問 1 つ（criteria は `FIT_LEVELS` の 5 段階）、1 回の evaluate でまとめて採点。instructions に入れるのは `Persona.description`（必須。Agent Skills の description 相当の短い担当説明）だけで、systemPrompt は送らない。`score`（0〜4 の加重平均）降順、同点は `confidence` 降順、さらに同点なら personas.ts の順。**confidence は `@ai-sdk/gateway` の zod スキーマで型付き answers から落とされる**ので、`result.response.body`（生 JSON）の `answers[id].confidence` から `readConfidence()` で拾う。本文に無ければ undefined で画面は「—」
- リクエスト本文は `{ selection: { mode: "manual", personaIds } | { mode: "auto", count }, rounds }` に変更。auto は初回のみ許可（追加質問は 400）
- 結果は `data-routing` パート（`Routing` 型）として run の先頭に流す。先に `done: false` を書いてスピナーを出す
- 失敗（キー欠落 / タイムアウト / Gateway エラー）は fatal。黙って別の顔ぶれで始めない
- クライアントは初回 run の `data-routing` から選ばれた ID を拾い、追加質問では `manual` として同じ顔ぶれを送る
- 認証は `AI_GATEWAY_API_KEY`（Vercel 上では OIDC も可）。実呼び出しの動作確認はキー設定後に行うこと。未検証
- デバッグ: `councilConfig.routing.debug`（開発モード既定 on、`ROUTING_DEBUG=0/1`）で evaluate の request / response をサーバーコンソールと `data-routing.debug` に出す。画面では選定カードの「デバッグ」折りたたみ。失敗時（キー欠落含む）も request とエラーを出す

## 注意点（ハマりどころ）

- **`.env` 系ファイルは読み書き禁止**（ユーザーの CLAUDE.md）。加えて、Bash コマンド文字列に `.env` という文字が含まれるだけでシークレット保護フックに止められる。README など `.env.local` に言及するファイルは **Write ツールで書く**こと（heredoc は不可）
- `create-next-app` が git init 済み。コミットはユーザーに言われるまでしない
- `streamText().textStream` はエラーを黙って飲み込むので使わない。`fullStream` を使う（実装済み）
- `validateUIMessages` の引数名は `dataSchemas`（確認済み）
- `useChat` の `status === 'ready'` を討論完了の判定に使わない（理由はプラン参照）
- Next.js 16 の `LayoutProps` / `PageProps` は `next dev` / `next typegen` 実行後にしか存在しない
- AGENTS.md / CLAUDE.md（`@AGENTS.md`）は create-next-app が生成したもの。そのままでよい
