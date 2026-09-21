import { createUIMessageStream, createUIMessageStreamResponse, generateId } from "ai";
import { runCouncil } from "@/lib/council";
import type { CouncilUIMessage } from "@/lib/types";
import { RequestValidationError, validateCouncilRequest } from "@/lib/validate";

// 討論は最大 17 回の直列呼び出しになる。デプロイ先が 300 秒を保証するとは限らない
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { code: "INVALID_REQUEST", message: "JSON として読み取れません" },
      { status: 400 },
    );
  }

  let validated;
  try {
    validated = await validateCouncilRequest(body);
  } catch (e) {
    if (e instanceof RequestValidationError) {
      return Response.json({ code: "INVALID_REQUEST", message: e.message }, { status: 400 });
    }
    throw e;
  }

  const runId = generateId();
  const stream = createUIMessageStream<CouncilUIMessage>({
    execute: ({ writer }) => runCouncil({ ...validated, writer, signal: req.signal, runId }),
    onError: (error) => {
      console.error("[council] stream error:", error);
      return "討論の処理中にエラーが発生しました。";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
