"use client";

import { Box, Heading, HStack, Separator, Spinner, Stack, Text } from "@chakra-ui/react";
import type { ChatStatus } from "ai";
import { Fragment, useEffect, useMemo, useRef } from "react";
import type { CouncilError, CouncilUIMessage, Phase, Routing, Speech } from "@/lib/types";
import { ErrorNotice } from "./ErrorNotice";
import { RoutingNotice } from "./RoutingNotice";
import { SpeechBubble } from "./SpeechBubble";

type Props = {
  messages: CouncilUIMessage[];
  status: ChatStatus;
  onReset: () => void;
};

function phaseHeading(phase: Phase, round?: number): string {
  switch (phase) {
    case "answer":
      return "回答";
    case "debate":
      return `討論 第${round ?? "?"}ラウンド`;
    case "summary":
      return "司会の総括";
  }
}

function userText(m: CouncilUIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function Timeline({ messages, status, onReset }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // ターンの開始・終了のタイミングでだけ末尾へスクロールする（1 文字ごとに追従しない）
  const turnCount = useMemo(
    () =>
      messages.reduce(
        (n, m) => n + m.parts.filter((p) => p.type === "data-speech").length,
        0,
      ),
    [messages],
  );
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnCount, status]);

  if (messages.length === 0) {
    return (
      <Stack align="center" justify="center" h="full" minH="40vh" color="fg.muted" px="6">
        <Text textAlign="center">
          著名人を 2〜4 名選ぶか「自動で選ぶ」をオンにして、悩みを入力すると討論が始まります。
        </Text>
      </Stack>
    );
  }

  const last = messages[messages.length - 1];
  const waitingForServer = status === "submitted" && last.role === "user";

  return (
    <Stack gap="6" pb="6">
      {messages.map((m) =>
        m.role === "user" ? (
          <UserMessage key={m.id} text={userText(m)} />
        ) : (
          <AssistantMessage key={m.id} message={m} onReset={onReset} />
        ),
      )}
      {waitingForServer && (
        <HStack color="fg.muted" textStyle="sm" px="2">
          <Spinner size="xs" />
          <Text>討論の準備をしています…</Text>
        </HStack>
      )}
      <div ref={bottomRef} />
    </Stack>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <HStack justify="flex-end">
      <Box
        maxW={{ base: "100%", md: "80%" }}
        bg="colorPalette.subtle"
        colorPalette="blue"
        borderWidth="1px"
        borderColor="colorPalette.muted"
        rounded="lg"
        px="4"
        py="3"
      >
        <Text textStyle="xs" color="fg.muted" mb="1">
          相談者
        </Text>
        <Text whiteSpace="pre-wrap" lineHeight="tall">
          {text}
        </Text>
      </Box>
    </HStack>
  );
}

/**
 * assistant メッセージ 1 件 = 1 run。この中でだけ phase / round の見出しを付ける。
 * run をまたいで phase で束ねると、追加質問の回答が 1 周目に混ざるため。
 */
function AssistantMessage({
  message,
  onReset,
}: {
  message: CouncilUIMessage;
  onReset: () => void;
}) {
  // ターンに紐づく非 fatal エラーは、そのターンの吹き出しの中に出す
  const turnErrors = new Map<string, CouncilError>();
  const standalone: CouncilError[] = [];
  for (const part of message.parts) {
    if (part.type !== "data-error") continue;
    if (part.data.turnId && !part.data.fatal) turnErrors.set(part.data.turnId, part.data);
    else standalone.push(part.data);
  }

  const items: Array<
    | { kind: "speech"; speech: Speech }
    | { kind: "error"; error: CouncilError }
    | { kind: "routing"; routing: Routing }
  > = [];
  for (const part of message.parts) {
    if (part.type === "data-speech") items.push({ kind: "speech", speech: part.data });
    else if (part.type === "data-routing") items.push({ kind: "routing", routing: part.data });
    else if (part.type === "data-error" && standalone.includes(part.data))
      items.push({ kind: "error", error: part.data });
  }

  let lastGroup: string | null = null;

  return (
    <Stack gap="4">
      {items.map((item, i) => {
        if (item.kind === "routing") {
          return <RoutingNotice key={`routing-${i}`} routing={item.routing} />;
        }
        if (item.kind === "error") {
          return (
            <ErrorNotice
              key={`err-${i}`}
              message={item.error.message}
              fatal={item.error.fatal}
              onReset={item.error.fatal ? onReset : undefined}
              size="sm"
            />
          );
        }
        const { speech } = item;
        const group = `${speech.phase}:${speech.round ?? ""}`;
        const showHeading = group !== lastGroup;
        lastGroup = group;
        return (
          <Fragment key={speech.turnId}>
            {showHeading && (
              <HStack gap="3" pt={i === 0 || items[i - 1].kind === "routing" ? 0 : 2}>
                <Heading size="sm" color="fg.muted" flexShrink={0}>
                  {phaseHeading(speech.phase, speech.round)}
                </Heading>
                <Separator flex="1" />
              </HStack>
            )}
            <SpeechBubble speech={speech} errorMessage={turnErrors.get(speech.turnId)?.message} />
          </Fragment>
        );
      })}
    </Stack>
  );
}
