import { councilConfig } from "@/config/council";
import { callSystemOne, TypeSafeApiError, type SystemOneRequest } from "@/lib/typesafe";
import type { Persona, Routing, RoutingCandidate, RoutingCall, RoutingDebug } from "@/lib/types";

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
function buildRequest(question: string, candidates: readonly Persona[]): SystemOneRequest {
  return {
    model: councilConfig.routing.model,
    state: `相談者からの相談内容:\n${question}`,
    questions: Object.fromEntries(
      candidates.map((p) => [
        p.id,
        {
          type: "score",
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
 * 候補 1 名につき score 質問を 1 つ立て、TypeSafe API への 1 回のリクエストでまとめて採点する。
 * score は段階の加重平均（0〜MAX_SCORE）。同点は confidence が高い方、さらに同点なら personas.ts の順。
 * confidence は評価モデルが分布の尖り具合から出す 0〜1 の値。
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
  const debugRequest: RoutingCall["request"] = request;
  log(`request → ${model}\n${JSON.stringify(request, null, 2)}`);

  // API キーがなければ TypeSafe を呼ばずに止める。request は組み立て済みなのでデバッグ表示には出せる
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    const error = "TYPESAFE_API_KEY が設定されていないため、送信しませんでした";
    calls.push({ request: debugRequest, error, elapsedMs: 0 });
    log(`skipped: ${error}`);
    return {
      kind: "error",
      code: "MISSING_API_KEY",
      message:
        "TYPESAFE_API_KEY が設定されていないため、回答者の自動選定ができません。README の手順に従って設定するか、著名人を手動で選んでください。",
      cause: null,
      debug: debug(),
    };
  }

  const timeoutSignal = AbortSignal.timeout(councilConfig.routing.timeoutMs);
  const routingSignal = AbortSignal.any([signal, timeoutSignal]);
  const startedAt = Date.now();

  let answers: Awaited<ReturnType<typeof callSystemOne>>["answers"];
  try {
    const response = await callSystemOne({
      apiKey,
      request,
      signal: routingSignal,
      maxRetries: 1,
    });
    answers = response.answers;

    const elapsedMs = Date.now() - startedAt;
    if (debugEnabled) {
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
      confidence: readConfidence(answer?.confidence),
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

/** confidence は API 仕様上は score 回答に必ず付くが、欠けていたら undefined（画面では「—」） */
function readConfidence(confidence: number | undefined): number | undefined {
  return confidence !== undefined && Number.isFinite(confidence)
    ? clamp(confidence, 0, 1)
    : undefined;
}

/** デバッグ表示用にエラーを文字列化する。TypeSafeApiError は statusCode と responseBody も拾う */
function serializeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const extra: Record<string, unknown> = {};
  if (e instanceof TypeSafeApiError) {
    extra.statusCode = e.statusCode;
    extra.responseBody = e.responseBody;
  }
  if (e.cause !== undefined) {
    extra.cause = e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : e.cause;
  }
  const head = `${e.name}: ${e.message}`;
  return Object.keys(extra).length > 0 ? `${head}\n${JSON.stringify(extra, null, 2)}` : head;
}

/** API の生エラーは画面に出さず、種類だけ利用者向けの文言に置き換える */
function describeRoutingError(e: unknown): string {
  const status = e instanceof TypeSafeApiError ? e.statusCode : undefined;
  if (status === 401 || status === 403) {
    return "TypeSafe の認証に失敗しました。TYPESAFE_API_KEY が正しいか確認してください。";
  }
  if (status === 404 || status === 422) {
    return `TypeSafe がリクエストを受け付けませんでした。評価モデル ${councilConfig.routing.model} が正しいか（ROUTING_MODEL の設定）を確認してください。`;
  }
  if (status === 429 || status === 529) {
    return "TypeSafe が混み合っているため、回答者の自動選定ができませんでした。しばらくしてからやり直すか、著名人を手動で選んでください。";
  }
  return "回答者の自動選定に失敗しました。著名人を手動で選ぶか、しばらくしてからやり直してください。";
}
