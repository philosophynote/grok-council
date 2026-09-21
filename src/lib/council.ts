import { streamText, type UIMessageStreamWriter } from "ai";
import { createXai } from "@ai-sdk/xai";
import { councilConfig } from "@/config/council";
import { moderator } from "@/config/moderator";
import { personas as allPersonas } from "@/config/personas";
import {
  buildModeratorSystemPrompt,
  buildPersonaSystemPrompt,
  buildTurnPrompt,
  type TranscriptEntry,
} from "@/lib/prompts";
import { routePersonas } from "@/lib/routing";
import type { CouncilError, CouncilUIMessage, Persona, Phase, Speech } from "@/lib/types";
import type { ValidatedRequest } from "@/lib/validate";

type Writer = UIMessageStreamWriter<CouncilUIMessage>;

export type RunCouncilInput = ValidatedRequest & {
  writer: Writer;
  signal: AbortSignal;
  runId: string;
};

class RunAborted extends Error {
  constructor() {
    super("run aborted");
    this.name = "RunAborted";
  }
}

class RunFatal extends Error {
  constructor(readonly error: CouncilError) {
    super(error.message);
    this.name = "RunFatal";
  }
}

/**
 * （自動選定 →）回答 → 討論 × rounds → 総括 を直列に実行し、writer に data-routing / data-speech / data-error を書く。
 * 1 ターンの失敗では止まらず次へ進む。止まるのは abort、API キー欠落、自動選定の失敗、timeout の連続のみ。
 */
export async function runCouncil(input: RunCouncilInput): Promise<void> {
  const { writer, signal, runId, selection, rounds, history, question, isFollowUp } = input;

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    writer.write({
      type: "data-error",
      data: {
        code: "MISSING_API_KEY",
        message:
          "XAI_API_KEY が設定されていません。README の手順に従って環境変数を設定し、開発サーバーを再起動してください。",
        fatal: true,
        runId,
      },
    });
    return;
  }
  const xai = createXai({ apiKey });
  const model = xai(councilConfig.model);

  const personas = await resolvePersonas({ writer, signal, runId, question, selection });
  if (!personas) return;

  const current: TranscriptEntry[] = [];
  let consecutiveTimeouts = 0;

  const turns: Array<{ speaker: Persona; phase: Phase; round?: number }> = [];
  for (const p of personas) turns.push({ speaker: p, phase: "answer" });
  for (let r = 1; r <= rounds; r++) {
    for (const p of personas) turns.push({ speaker: p, phase: "debate", round: r });
  }
  turns.push({ speaker: moderator, phase: "summary" });

  try {
    for (const turn of turns) {
      // stop 直後に次の xAI 呼び出しを始めない
      if (signal.aborted) throw new RunAborted();

      const isModerator = turn.speaker.id === moderator.id;
      const system = isModerator
        ? buildModeratorSystemPrompt(personas)
        : buildPersonaSystemPrompt(turn.speaker, personas);
      const prompt = buildTurnPrompt({
        phase: turn.phase,
        round: turn.round,
        rounds,
        history,
        question,
        isFollowUp,
        current,
        speaker: turn.speaker,
        participants: personas,
      });

      const turnId = `${runId}:${turn.phase}${turn.round ?? ""}:${turn.speaker.id}`;
      const base: Speech = {
        runId,
        turnId,
        personaId: turn.speaker.id,
        name: turn.speaker.name,
        title: turn.speaker.title,
        color: turn.speaker.color,
        phase: turn.phase,
        round: turn.round,
        text: "",
        done: false,
      };

      const outcome = await runTurn({
        writer,
        signal,
        base,
        system,
        prompt,
        model,
        maxOutputTokens: councilConfig.maxOutputTokens[turn.phase],
      });

      if (outcome.kind === "aborted") throw new RunAborted();

      if (outcome.kind === "timeout") {
        consecutiveTimeouts += 1;
        const fatal = consecutiveTimeouts >= councilConfig.maxConsecutiveTimeouts;
        const error: CouncilError = {
          code: "TIMEOUT",
          message: fatal
            ? `${turn.speaker.name} の応答がタイムアウトしました。連続して失敗したため討論を終了します。`
            : `${turn.speaker.name} の応答がタイムアウトしました。次の発言に進みます。`,
          fatal,
          runId,
          turnId,
        };
        writer.write({ type: "data-error", data: error });
        if (fatal) throw new RunFatal(error);
      } else if (outcome.kind === "error") {
        consecutiveTimeouts = 0;
        console.error(`[council] turn ${turnId} failed:`, outcome.cause);
        writer.write({
          type: "data-error",
          data: {
            code: "MODEL_ERROR",
            message: `${turn.speaker.name} の発言を取得できませんでした。次の発言に進みます。`,
            fatal: false,
            runId,
            turnId,
          },
        });
      } else {
        consecutiveTimeouts = 0;
      }

      if (outcome.text.trim().length > 0) {
        current.push({
          kind: "speech",
          name: turn.speaker.name,
          phase: turn.phase,
          round: turn.round,
          text: outcome.text,
        });
      }
    }
  } catch (e) {
    if (e instanceof RunAborted || e instanceof RunFatal) return;
    throw e;
  }
}

/**
 * 参加者を確定する。manual ならそのまま、auto なら評価モデルで選ぶ。
 * auto の失敗は fatal として扱う。黙って別の顔ぶれで始めると、利用者が「質問に合わせて選ばれた」と誤解するため。
 * 続行できないときは data-error を書いて null を返す
 */
async function resolvePersonas(args: {
  writer: Writer;
  signal: AbortSignal;
  runId: string;
  question: string;
  selection: ValidatedRequest["selection"];
}): Promise<Persona[] | null> {
  const { writer, signal, runId, question, selection } = args;
  if (selection.mode === "manual") return selection.personas;

  // 「回答者を選んでいます…」を即座に出すため、空の結果を先に書く
  // （認証情報の有無は routePersonas が確認し、なければ Gateway を呼ばずに MISSING_API_KEY を返す）
  const routingId = `${runId}:routing`;
  writer.write({
    type: "data-routing",
    id: routingId,
    data: {
      runId,
      count: selection.count,
      model: councilConfig.routing.model,
      candidates: [],
      done: false,
    },
  });

  const outcome = await routePersonas({
    runId,
    question,
    candidates: allPersonas,
    count: selection.count,
    signal,
  });

  if (outcome.kind === "aborted") return null;

  if (outcome.kind === "ok") {
    writer.write({ type: "data-routing", id: routingId, data: outcome.routing });
    return outcome.personas;
  }

  if (outcome.kind === "error" && outcome.cause != null) {
    console.error("[council] routing failed:", outcome.cause);
  }

  // デバッグ有効時は、失敗しても送受信内容を画面で確認できるよう空の結果として確定する
  if (outcome.debug) {
    writer.write({
      type: "data-routing",
      id: routingId,
      data: {
        runId,
        count: selection.count,
        model: councilConfig.routing.model,
        candidates: [],
        done: true,
        debug: outcome.debug,
      },
    });
  }
  writer.write({
    type: "data-error",
    data: {
      code: outcome.kind === "timeout" ? "TIMEOUT" : outcome.code,
      message:
        outcome.kind === "timeout"
          ? "回答者の自動選定がタイムアウトしました。著名人を手動で選ぶか、しばらくしてからやり直してください。"
          : outcome.message,
      fatal: true,
      runId,
    },
  });
  return null;
}

type TurnOutcome =
  | { kind: "ok"; text: string }
  | { kind: "timeout"; text: string }
  | { kind: "aborted"; text: string }
  | { kind: "error"; text: string; cause: unknown };

async function runTurn(args: {
  writer: Writer;
  signal: AbortSignal;
  base: Speech;
  system: string;
  prompt: string;
  model: ReturnType<ReturnType<typeof createXai>>;
  maxOutputTokens: number;
}): Promise<TurnOutcome> {
  const { writer, signal, base, system, prompt, model, maxOutputTokens } = args;

  let text = "";
  let lastFlush = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const write = (patch: Partial<Speech> = {}) => {
    writer.write({ type: "data-speech", id: base.turnId, data: { ...base, text, ...patch } });
    lastFlush = Date.now();
  };
  const scheduleFlush = () => {
    if (pending) return;
    const wait = Math.max(0, councilConfig.flushIntervalMs - (Date.now() - lastFlush));
    pending = setTimeout(() => {
      pending = null;
      write();
    }, wait);
  };
  const cancelPending = () => {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
  };

  // 「○○が考えています…」を即座に出すため、空の発言を先に書く
  write();

  const timeoutSignal = AbortSignal.timeout(councilConfig.turnTimeoutMs);
  const turnSignal = AbortSignal.any([signal, timeoutSignal]);

  let streamError: unknown = null;
  let aborted = false;

  try {
    const result = streamText({
      model,
      system,
      prompt,
      maxOutputTokens,
      abortSignal: turnSignal,
      providerOptions: { xai: { reasoningEffort: councilConfig.reasoningEffort } },
    });

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        scheduleFlush();
      } else if (part.type === "error") {
        streamError = part.error;
      } else if (part.type === "abort") {
        aborted = true;
      }
    }
  } catch (e) {
    if (turnSignal.aborted) aborted = true;
    else streamError = e;
  } finally {
    cancelPending();
  }

  if (signal.aborted) {
    write({ done: true, aborted: true });
    return { kind: "aborted", text };
  }
  if (timeoutSignal.aborted || aborted) {
    write({ done: true, aborted: true });
    return { kind: "timeout", text };
  }
  if (streamError != null) {
    write({ done: true, aborted: text.length > 0 });
    return { kind: "error", text, cause: streamError };
  }
  write({ done: true });
  return { kind: "ok", text };
}
