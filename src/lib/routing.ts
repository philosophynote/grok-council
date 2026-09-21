import { experimental_evaluate as evaluate } from "ai";
import { councilConfig } from "@/config/council";
import type { Persona, Routing, RoutingCandidate, RoutingCall, RoutingDebug } from "@/lib/types";

/**
 * 自動選定に使う Vercel AI Gateway の認証情報があるか。
 * ローカルでは AI_GATEWAY_API_KEY、Vercel 上では OIDC トークンで認証される
 */
function hasRoutingCredentials(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

export type RoutingOutcome =
  | { kind: "ok"; personas: Persona[]; routing: Routing }
  | { kind: "aborted" }
  | { kind: "timeout"; debug?: RoutingDebug }
  | {
      kind: "error";
      code: "ROUTING_ERROR" | "MISSING_API_KEY";
      message: string;
      cause: unknown;
      debug?: RoutingDebug;
    };

/**
 * 適性の段階（score 質問の criteria）。低い方から高い方へ並べる。
 * 評価モデルは各段階の確率分布と、その加重平均（0〜段階数-1）を返す
 */
export const FIT_LEVELS = [
  "全く噛み合わない。この人物が語れることと相談内容に接点がない",
  "接点は薄い。この相談には一般論しか言えない",
  "部分的に噛み合う。相談の一側面には独自の視点で答えられる",
  "よく噛み合う。専門・経験・価値観から具体的に語れる",
  "最適。この相談のためにいるような人物で、独自の視点と実体験で核心に答えられる",
] as const;

export const MAX_SCORE = FIT_LEVELS.length - 1;

/**
 * 候補 1 名につき score 質問 1 つ。全員分を 1 回のリクエストにまとめる。
 * 判定材料は systemPrompt ではなく persona.description（担当する相談の短い説明）だけ。
 * systemPrompt は口調や回答の型が大半で選定には不要な上、全員分を入れるとリクエストが肥大化するため
 */
function buildRequest(question: string, candidates: readonly Persona[]) {
  return {
    model: councilConfig.routing.model,
    state: `相談者からの相談内容:\n${question}`,
    questions: Object.fromEntries(
      candidates.map((p) => [
        p.id,
        {
          type: "score" as const,
          instructions:
            `「${p.name}（${p.title}）」はこの相談の回答者としてどの程度適しているか。` +
            `担当領域と相談内容の噛み合いで判断せよ。\n担当領域: ${p.description.trim()}`,
          criteria: [...FIT_LEVELS],
        },
      ]),
    ),
  };
}

/**
 * 相談内容に対する各著名人の適性を評価モデルに採点させ、スコアの高い順に count 名を選ぶ。
 *
 * 候補 1 名につき score 質問を 1 つ立て、1 回の evaluate 呼び出しでまとめて採点する。
 * score は段階の加重平均（0〜MAX_SCORE）。同点は confidence が高い方、さらに同点なら personas.ts の順。
 * confidence は評価モデルが分布の尖り具合から出す 0〜1 の値で、Gateway の型付きレスポンスには
 * 含まれないため生のレスポンス本文から拾う。
 */
export async function routePersonas(args: {
  runId: string;
  question: string;
  candidates: readonly Persona[];
  count: number;
  signal: AbortSignal;
}): Promise<RoutingOutcome> {
  const { runId, question, candidates, signal } = args;
  const count = Math.min(args.count, candidates.length);
  const model = councilConfig.routing.model;
  const debugEnabled = councilConfig.routing.debug;

  const calls: RoutingCall[] = [];
  const debug = (): RoutingDebug | undefined => (debugEnabled ? { calls } : undefined);
  const log = (line: string) => {
    if (debugEnabled) console.log(`[routing] ${line}`);
  };

  const request = buildRequest(question, candidates);
  // デバッグ記録用の緩い型（RoutingCall.request）。evaluate には推論の効く request をそのまま渡す
  const debugRequest: RoutingCall["request"] = request;
  log(`request → ${model}\n${JSON.stringify(request, null, 2)}`);

  // 認証情報がなければ Gateway を呼ばずに止める。request は組み立て済みなのでデバッグ表示には出せる
  if (!hasRoutingCredentials()) {
    const error =
      "AI_GATEWAY_API_KEY（または VERCEL_OIDC_TOKEN）が設定されていないため、送信しませんでした";
    calls.push({ request: debugRequest, error, elapsedMs: 0 });
    log(`skipped: ${error}`);
    return {
      kind: "error",
      code: "MISSING_API_KEY",
      message:
        "AI_GATEWAY_API_KEY が設定されていないため、回答者の自動選定ができません。README の手順に従って設定するか、著名人を手動で選んでください。",
      cause: null,
      debug: debug(),
    };
  }

  const timeoutSignal = AbortSignal.timeout(councilConfig.routing.timeoutMs);
  const routingSignal = AbortSignal.any([signal, timeoutSignal]);
  const startedAt = Date.now();

  let answers: Record<string, { type: "score"; score: number; probabilities?: Record<string, number> }>;
  let rawBody: unknown;
  try {
    const result = await evaluate({
      model,
      state: request.state,
      questions: request.questions,
      maxRetries: 1,
      abortSignal: routingSignal,
    });
    answers = result.answers;
    rawBody = result.response.body;

    const elapsedMs = Date.now() - startedAt;
    if (debugEnabled) {
      const response = {
        answers: result.answers,
        usage: result.usage,
        warnings: result.warnings,
        rounding: result.rounding,
        providerMetadata: result.providerMetadata,
        response: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp.toISOString(),
          body: result.response.body,
        },
      };
      calls.push({ request: debugRequest, response, elapsedMs });
      log(`response ← ${model} (${elapsedMs}ms)\n${JSON.stringify(response, null, 2)}`);
    }
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    if (debugEnabled) {
      const error = serializeError(e);
      calls.push({ request: debugRequest, error, elapsedMs });
      log(`failed after ${elapsedMs}ms\n${error}`);
    }
    if (signal.aborted) return { kind: "aborted" };
    if (timeoutSignal.aborted) return { kind: "timeout", debug: debug() };
    return {
      kind: "error",
      code: "ROUTING_ERROR",
      message: describeRoutingError(e),
      cause: e,
      debug: debug(),
    };
  }

  const scored = candidates.map((p, index) => {
    const answer = answers[p.id];
    return {
      persona: p,
      index,
      score: clamp(answer?.score ?? 0, 0, MAX_SCORE),
      confidence: readConfidence(rawBody, p.id),
    };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score || (b.confidence ?? -1) - (a.confidence ?? -1) || a.index - b.index,
  );

  const selected = scored.slice(0, count);
  const selectedIds = new Set(selected.map((s) => s.persona.id));
  const routingCandidates: RoutingCandidate[] = scored.map((s) => ({
    personaId: s.persona.id,
    name: s.persona.name,
    title: s.persona.title,
    color: s.persona.color,
    score: s.score,
    maxScore: MAX_SCORE,
    confidence: s.confidence,
    selected: selectedIds.has(s.persona.id),
  }));

  return {
    kind: "ok",
    personas: selected.map((s) => s.persona),
    routing: { runId, count, model, candidates: routingCandidates, done: true, debug: debug() },
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * 生のレスポンス本文から confidence を拾う。
 * @ai-sdk/gateway の zod スキーマは answers から confidence を落とすので、型付きの answers には入っていない。
 * 本文の形は { answers: { [id]: { confidence?: number } } } を想定し、なければ undefined
 */
function readConfidence(body: unknown, questionId: string): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const answers = (body as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return undefined;
  const answer = (answers as Record<string, unknown>)[questionId];
  if (typeof answer !== "object" || answer === null) return undefined;
  const confidence = (answer as { confidence?: unknown }).confidence;
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? clamp(confidence, 0, 1)
    : undefined;
}

/** デバッグ表示用にエラーを文字列化する。provider のエラーは statusCode や responseBody も持つので拾う */
function serializeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const extra: Record<string, unknown> = {};
  for (const key of ["statusCode", "responseBody", "url", "isRetryable", "generationId", "type"]) {
    const value = (e as unknown as Record<string, unknown>)[key];
    if (value !== undefined) extra[key] = value;
  }
  if (e.cause !== undefined) {
    extra.cause = e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : e.cause;
  }
  const head = `${e.name}: ${e.message}`;
  return Object.keys(extra).length > 0 ? `${head}\n${JSON.stringify(extra, null, 2)}` : head;
}

/** provider の生エラーは画面に出さず、種類だけ利用者向けの文言に置き換える */
function describeRoutingError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "GatewayAuthenticationError") {
    return "AI Gateway の認証に失敗しました。AI_GATEWAY_API_KEY が正しいか確認してください。";
  }
  if (name === "GatewayModelNotFoundError") {
    return `評価モデル ${councilConfig.routing.model} が見つかりません。ROUTING_MODEL の設定を確認してください。`;
  }
  return "回答者の自動選定に失敗しました。著名人を手動で選ぶか、しばらくしてからやり直してください。";
}
