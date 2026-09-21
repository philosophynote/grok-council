/**
 * 討論の動作設定。モデルや上限値を変えたいときはここを編集する。
 * 環境変数 GROK_MODEL / GROK_REASONING_EFFORT / ROUTING_MODEL で実行時に上書きできる。
 */

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

function readReasoningEffort(): ReasoningEffort {
  const raw = process.env.GROK_REASONING_EFFORT;
  return REASONING_EFFORTS.includes(raw as ReasoningEffort)
    ? (raw as ReasoningEffort)
    : "none";
}

export const councilConfig = {
  /** 使用する Grok のモデル ID */
  model: process.env.GROK_MODEL ?? "grok-4.3",
  /** 思考トークンの量。多ターンなので既定では使わない */
  reasoningEffort: readReasoningEffort(),

  /** 参加者数の下限・上限 */
  minPersonas: 2,
  maxPersonas: 4,
  /** 討論ラウンド数の下限・上限 */
  minRounds: 1,
  maxRounds: 3,

  /** フェーズごとの出力トークン上限 */
  maxOutputTokens: {
    answer: 512,
    debate: 384,
    summary: 768,
  },
  /** フェーズごとの文字数目安（プロンプトで伝える） */
  targetChars: {
    answer: 300,
    debate: 250,
    summary: 400,
  },

  /** 1 ターンあたりのタイムアウト */
  turnTimeoutMs: 60_000,
  /** タイムアウトがこの回数連続したら run を打ち切る */
  maxConsecutiveTimeouts: 2,
  /** ストリーム書き込みの間引き間隔 */
  flushIntervalMs: 40,

  /**
   * 相談内容に応じた回答者の自動選定。
   * Vercel AI Gateway の評価モデル（既定 typesafe-ai/jev）に全著名人の適性を採点させ、上位から選ぶ。
   * 環境変数 AI_GATEWAY_API_KEY が必要
   */
  routing: {
    /** 評価モデル ID（Gateway 上の ID） */
    model: process.env.ROUTING_MODEL ?? "typesafe-ai/jev",
    /** 自動選定で選ぶ人数の既定値 */
    defaultCount: 3,
    /** 採点 1 回のタイムアウト */
    timeoutMs: 30_000,
    /**
     * 評価モデルへの request / response をサーバーコンソールと画面に出す。
     * 環境変数 ROUTING_DEBUG=1 / 0 で明示的に切り替え。未指定なら開発モードでのみ有効
     */
    debug:
      process.env.ROUTING_DEBUG != null
        ? process.env.ROUTING_DEBUG === "1"
        : process.env.NODE_ENV === "development",
  },

  /** クライアントから受け取る入力の上限 */
  limits: {
    maxMessages: 20,
    maxUserTextChars: 2_000,
    maxTranscriptChars: 30_000,
  },
} as const;
