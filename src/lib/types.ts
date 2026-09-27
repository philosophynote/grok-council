import type { UIMessage } from "ai";

export type Persona = {
  id: string;
  name: string;
  title: string;
  systemPrompt: string;
  color: string;
  /**
   * どんな相談を担当するかの短い説明（Agent Skills の description に相当）。
   * 回答者の自動選定では systemPrompt ではなくこれだけを評価モデルに送る。
   * 「どんな相談に向くか」と「どの立場から答えるか」を 1〜3 文で
   */
  description: string;
};

export type Phase = "answer" | "debate" | "summary";

/** 1 ターン（1 人の 1 発言）をあらわす data パート。同じ turnId のパートは置き換えられる */
export type Speech = {
  runId: string;
  turnId: string;
  personaId: string;
  name: string;
  title: string;
  color: string;
  phase: Phase;
  round?: number;
  text: string;
  done: boolean;
  aborted?: boolean;
};

/** 自動選定の候補 1 名分の判定結果 */
export type RoutingCandidate = {
  personaId: string;
  name: string;
  title: string;
  color: string;
  /** 適性スコア。段階の加重平均で 0〜maxScore */
  score: number;
  /** スコアの上限（段階数 - 1） */
  maxScore: number;
  /**
   * 評価モデルの確信度（0〜1）。確率分布が 1 つの段階に集中しているほど高い。
   * レスポンス本文に含まれていなければ undefined
   */
  confidence?: number;
  selected: boolean;
};

/** デバッグ用: 評価モデルへの 1 回の呼び出し */
export type RoutingCall = {
  request: {
    model: string;
    state: string;
    questions: Record<string, unknown>;
  };
  /** 成功時。evaluate の戻り値のうち JSON にできる部分 */
  response?: unknown;
  /** 失敗時のエラー内容 */
  error?: string;
  /** 所要時間（ms） */
  elapsedMs: number;
};

/** デバッグ用: 評価モデルとの送受信の記録（config.routing.debug のときだけ付く）。通常は 1 回 */
export type RoutingDebug = {
  calls: RoutingCall[];
};

/** 回答者の自動選定の結果をあらわす data パート。run の先頭に 1 つだけ書かれる */
export type Routing = {
  runId: string;
  /** 選ぶ人数 */
  count: number;
  /** 使った評価モデル ID */
  model: string;
  /** 確率の高い順。done になるまでは空。失敗時は done でも空 */
  candidates: RoutingCandidate[];
  done: boolean;
  debug?: RoutingDebug;
};

export type CouncilErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_REQUEST"
  | "MODEL_ERROR"
  | "TIMEOUT"
  | "ROUTING_ERROR";

export type CouncilError = {
  code: CouncilErrorCode;
  message: string;
  /** true なら run はここで終わっている */
  fatal: boolean;
  runId: string;
  /** どのターンで起きたか（ターンに紐づく場合） */
  turnId?: string;
};

export type CouncilDataParts = {
  speech: Speech;
  error: CouncilError;
  routing: Routing;
};

export type CouncilUIMessage = UIMessage<never, CouncilDataParts>;

/**
 * 参加者の選び方。
 * - manual: 利用者が選んだ著名人 ID をそのまま使う
 * - auto:   相談内容に応じてサーバーが count 名を選ぶ（初回の相談でのみ使える）
 */
export type PersonaSelection =
  | { mode: "manual"; personaIds: string[] }
  | { mode: "auto"; count: number };

/** リクエスト本文（messages 以外） */
export type CouncilRequestBody = {
  selection: PersonaSelection;
  rounds: number;
};
