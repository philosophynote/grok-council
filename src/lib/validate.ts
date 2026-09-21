import { safeValidateUIMessages } from "ai";
import { z } from "zod";
import { councilConfig } from "@/config/council";
import { personaMap } from "@/config/personas";
import type { TranscriptEntry } from "@/lib/prompts";
import type { CouncilUIMessage, Persona } from "@/lib/types";

const phaseSchema = z.enum(["answer", "debate", "summary"]);

export const speechSchema = z.object({
  runId: z.string().min(1).max(64),
  turnId: z.string().min(1).max(128),
  personaId: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  title: z.string().max(128),
  color: z.string().max(32),
  phase: phaseSchema,
  round: z.number().int().min(1).max(councilConfig.maxRounds).optional(),
  text: z.string().max(8_000),
  done: z.boolean(),
  aborted: z.boolean().optional(),
});

export const councilErrorSchema = z.object({
  code: z.enum(["MISSING_API_KEY", "INVALID_REQUEST", "MODEL_ERROR", "TIMEOUT", "ROUTING_ERROR"]),
  message: z.string().max(1_000),
  fatal: z.boolean(),
  runId: z.string().max(64),
  turnId: z.string().max(128).optional(),
});

export const routingSchema = z.object({
  runId: z.string().min(1).max(64),
  count: z.number().int().min(1).max(councilConfig.maxPersonas),
  model: z.string().max(128),
  candidates: z
    .array(
      z.object({
        personaId: z.string().min(1).max(64),
        name: z.string().min(1).max(64),
        title: z.string().max(128),
        color: z.string().max(32),
        score: z.number().min(0).max(10),
        maxScore: z.number().int().min(1).max(10),
        confidence: z.number().min(0).max(1).optional(),
        selected: z.boolean(),
      }),
    )
    .max(200),
  done: z.boolean(),
  debug: z
    .object({
      calls: z
        .array(
          z.object({
            request: z.object({
              model: z.string().max(128),
              state: z.string().max(10_000),
              questions: z.record(z.string(), z.unknown()),
            }),
            response: z.unknown().optional(),
            error: z.string().max(2_000).optional(),
            elapsedMs: z.number().min(0),
          }),
        )
        .max(4),
    })
    .optional(),
});

const personaCountSchema = z.number().int().min(councilConfig.minPersonas).max(councilConfig.maxPersonas);

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("manual"),
    personaIds: z
      .array(z.string().min(1).max(64))
      .min(councilConfig.minPersonas)
      .max(councilConfig.maxPersonas),
  }),
  z.object({
    mode: z.literal("auto"),
    count: personaCountSchema,
  }),
]);

const bodySchema = z.object({
  selection: selectionSchema,
  rounds: z.number().int().min(councilConfig.minRounds).max(councilConfig.maxRounds),
  messages: z.array(z.unknown()).min(1).max(councilConfig.limits.maxMessages),
});

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

/** 検証済みの参加者の選び方。manual は Persona に解決済み、auto は runCouncil が選ぶ */
export type ValidatedSelection =
  | { mode: "manual"; personas: Persona[] }
  | { mode: "auto"; count: number };

export type ValidatedRequest = {
  selection: ValidatedSelection;
  rounds: number;
  /** 過去 run の履歴。クライアント由来なので構造の正しさしか保証されない */
  history: TranscriptEntry[];
  question: string;
  isFollowUp: boolean;
};

/**
 * リクエスト本文を検証し、討論に必要な形へ変換する。
 *
 * 注意: messages はクライアントが送ってくるため、過去の発言が本当にサーバー生成かどうかは
 * 検証できない（履歴をサーバーに保存しない設計上の割り切り）。ここでは構造と上限のみを保証する。
 */
export async function validateCouncilRequest(raw: unknown): Promise<ValidatedRequest> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new RequestValidationError(
      `リクエストの形式が不正です: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  const { rounds } = parsed.data;

  let selection: ValidatedSelection;
  if (parsed.data.selection.mode === "manual") {
    const { personaIds } = parsed.data.selection;
    if (new Set(personaIds).size !== personaIds.length) {
      throw new RequestValidationError("同じ著名人が重複して指定されています");
    }
    const unknown = personaIds.filter((id) => !personaMap.has(id));
    if (unknown.length > 0) {
      throw new RequestValidationError(
        `存在しない著名人 ID が含まれています: ${unknown.join(", ")}`,
      );
    }
    selection = { mode: "manual", personas: personaIds.map((id) => personaMap.get(id)!) };
  } else {
    const { count } = parsed.data.selection;
    if (count > personaMap.size) {
      throw new RequestValidationError(
        `自動選定の人数（${count}）が登録されている著名人の数（${personaMap.size}）を超えています`,
      );
    }
    selection = { mode: "auto", count };
  }

  const validated = await safeValidateUIMessages<CouncilUIMessage>({
    messages: parsed.data.messages,
    dataSchemas: { speech: speechSchema, error: councilErrorSchema, routing: routingSchema },
  });
  if (!validated.success) {
    throw new RequestValidationError("会話履歴の形式が不正です");
  }
  const messages = validated.data;

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") {
      throw new RequestValidationError("許可されていない role が含まれています");
    }
    for (const part of m.parts) {
      const ok =
        part.type === "text" ||
        part.type === "data-speech" ||
        part.type === "data-error" ||
        part.type === "data-routing";
      if (!ok) {
        throw new RequestValidationError(`許可されていないパートが含まれています: ${part.type}`);
      }
      if (m.role === "user" && part.type !== "text") {
        throw new RequestValidationError("相談者のメッセージにテキスト以外が含まれています");
      }
    }
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    throw new RequestValidationError("最後のメッセージが相談者のものではありません");
  }
  const question = textOf(last);
  if (question.trim().length === 0) {
    throw new RequestValidationError("相談内容が空です");
  }
  if (question.length > councilConfig.limits.maxUserTextChars) {
    throw new RequestValidationError(
      `相談内容は ${councilConfig.limits.maxUserTextChars} 文字以内にしてください`,
    );
  }

  const history = buildHistory(messages.slice(0, -1));
  const isFollowUp = history.length > 0;

  // 参加者は初回で確定させる。追加質問で選び直すと、討論の続きにならない
  if (isFollowUp && selection.mode === "auto") {
    throw new RequestValidationError(
      "追加質問では回答者の自動選定は使えません。初回に選ばれた著名人を指定してください",
    );
  }

  return {
    selection,
    rounds,
    history,
    question,
    isFollowUp,
  };
}

function textOf(m: CouncilUIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** 過去メッセージから発言録を復元する。合計文字数が上限を超えたら古い run から落とす */
function buildHistory(messages: CouncilUIMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  let userCount = 0;
  for (const m of messages) {
    if (m.role === "user") {
      const text = textOf(m);
      if (text.trim().length === 0) continue;
      entries.push({ kind: "user", text, followUp: userCount > 0 });
      userCount += 1;
      continue;
    }
    for (const part of m.parts) {
      if (part.type !== "data-speech") continue;
      const s = part.data;
      if (s.text.trim().length === 0) continue;
      entries.push({
        kind: "speech",
        name: s.name,
        phase: s.phase,
        round: s.round,
        text: s.text,
        aborted: s.aborted,
      });
    }
  }

  let total = entries.reduce((n, e) => n + e.text.length, 0);
  while (total > councilConfig.limits.maxTranscriptChars && entries.length > 0) {
    // 先頭の user 発言から次の user 発言の直前までを 1 run として丸ごと落とす
    const nextUser = entries.findIndex((e, i) => i > 0 && e.kind === "user");
    const dropCount = nextUser === -1 ? entries.length : nextUser;
    const dropped = entries.splice(0, dropCount);
    total -= dropped.reduce((n, e) => n + e.text.length, 0);
  }
  if (entries.length > 0 && entries[0].kind === "user") {
    entries[0] = { ...entries[0], followUp: false };
  }
  return entries;
}
