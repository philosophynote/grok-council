import { z } from "zod";

/**
 * TypeSafe AI の System One API（https://docs.typesafe.ai/api）を直接呼ぶ最小限のクライアント。
 * 使うのは score 質問だけなので、リクエスト・レスポンスの型もそこに絞っている
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** 再試行する HTTP ステータス。429 はレート制限、529 は TypeSafe 側の過負荷 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);
/** 再試行までの待ち時間。retry-after ヘッダーがあればそれに従うが、この上限で切る */
const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5_000;

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type SystemOneRequest = {
  model: string;
  state: string;
  questions: Record<string, ScoreQuestion>;
};

const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().optional(),
});

const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), scoreAnswerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

export type SystemOneResponse = z.infer<typeof responseSchema>;

/** API が 2xx 以外を返した、またはレスポンスの形が想定と違う */
export class TypeSafeApiError extends Error {
  override name = "TypeSafeApiError";
  constructor(
    message: string,
    readonly statusCode: number | undefined,
    readonly responseBody: unknown,
  ) {
    super(message);
  }
}

/**
 * state と質問をまとめて 1 回送る。再試行可能なエラー（429 / 529 / 5xx / 通信エラー）は
 * maxRetries 回まで再送する。signal が中断されたら待機中でもすぐに AbortError で抜ける
 */
export async function callSystemOne(args: {
  apiKey: string;
  request: SystemOneRequest;
  signal: AbortSignal;
  maxRetries: number;
}): Promise<SystemOneResponse> {
  const { apiKey, request, signal, maxRetries } = args;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
    } catch (e) {
      if (signal.aborted || attempt >= maxRetries) throw e;
      await sleep(RETRY_DELAY_MS, signal);
      continue;
    }

    const body = await readBody(res);
    if (res.ok) {
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        throw new TypeSafeApiError("TypeSafe のレスポンスの形が想定と異なります", res.status, body);
      }
      return parsed.data;
    }

    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
      await sleep(retryDelayMs(res), signal);
      continue;
    }
    throw new TypeSafeApiError(`TypeSafe API がステータス ${res.status} を返しました`, res.status, body);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function retryDelayMs(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_DELAY_MS;
  return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
