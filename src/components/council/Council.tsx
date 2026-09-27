"use client";

import { Box, Flex, Heading, HStack, Separator, Stack, Text } from "@chakra-ui/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo, useState } from "react";
import { ColorModeButton } from "@/components/ui/color-mode";
import { councilConfig } from "@/config/council";
import { personas } from "@/config/personas";
import type { CouncilRequestBody, CouncilUIMessage, PersonaSelection } from "@/lib/types";
import { ConsultForm } from "./ConsultForm";
import { describeChatError, ErrorNotice } from "./ErrorNotice";
import { PersonaPicker, type SelectionMode } from "./PersonaPicker";
import { Timeline } from "./Timeline";

function findRoutedIds(messages: CouncilUIMessage[]): string[] {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (p.type === "data-routing" && p.data.done) {
        return p.data.candidates.filter((c) => c.selected).map((c) => c.personaId);
      }
    }
  }
  return [];
}

export function Council() {
  const [mode, setMode] = useState<SelectionMode>("manual");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [autoCount, setAutoCount] = useState<number>(councilConfig.routing.defaultCount);
  const [rounds, setRounds] = useState<number>(councilConfig.minRounds);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () => new DefaultChatTransport<CouncilUIMessage>({ api: "/api/council" }),
    [],
  );
  const { messages, sendMessage, stop, status, error, setMessages, clearError } =
    useChat<CouncilUIMessage>({ transport });

  const busy = status === "submitted" || status === "streaming";
  const started = messages.length > 0;

  // 最新の assistant メッセージ（= 直近の run）
  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );

  // 自動選定で選ばれた顔ぶれ。初回 run の data-routing から取り、追加質問ではこれを固定して送る
  const routedIds = findRoutedIds(messages);

  // 追加質問ができるのは「直近の run で司会の総括が最後まで出た」ときだけ。
  // status === 'ready' は初期状態や途中失敗後にも立つので、完了判定には使わない。
  const lastRunCompleted = useMemo(() => {
    if (!lastAssistant) return false;
    const failedTurnIds = new Set(
      lastAssistant.parts
        .filter((p) => p.type === "data-error")
        .map((p) => p.data.turnId)
        .filter((id): id is string => !!id),
    );
    return lastAssistant.parts.some(
      (p) =>
        p.type === "data-speech" &&
        p.data.phase === "summary" &&
        p.data.done &&
        !p.data.aborted &&
        p.data.text.trim().length > 0 &&
        !failedTurnIds.has(p.data.turnId),
    );
  }, [lastAssistant]);

  const fatalError = useMemo(() => {
    for (const p of lastAssistant?.parts ?? []) {
      if (p.type === "data-error" && p.data.fatal) return p.data;
    }
    return null;
  }, [lastAssistant]);
  const requestErrorMessage = error ? describeChatError(error) : null;

  const reset = useCallback(() => {
    stop();
    clearError();
    setMessages([]);
    setInput("");
  }, [stop, clearError, setMessages]);

  const selectionValid =
    mode === "auto" ||
    (selectedIds.length >= councilConfig.minPersonas &&
      selectedIds.length <= councilConfig.maxPersonas);

  let blockedReason: string | undefined;
  if (!started) {
    if (!selectionValid) {
      blockedReason = `著名人を ${councilConfig.minPersonas}〜${councilConfig.maxPersonas} 名選ぶか、「自動で選ぶ」をオンにしてください`;
    }
  } else if (requestErrorMessage || fatalError) {
    blockedReason = "エラーで討論が止まりました。「最初からやり直す」を押してください";
  } else if (!lastRunCompleted) {
    blockedReason = "司会の総括まで完了すると追加質問ができます";
  } else if (mode === "auto" && routedIds.length === 0) {
    blockedReason = "自動選定の結果が取得できませんでした。「最初からやり直す」を押してください";
  }

  const submit = async () => {
    const text = input.trim();
    if (!text || busy || blockedReason) return;
    setInput("");

    // 参加者は初回で確定する。auto は初回だけ送り、追加質問では選ばれた顔ぶれを manual として送る
    let selection: PersonaSelection;
    if (mode === "auto") {
      selection = started
        ? { mode: "manual", personaIds: routedIds }
        : { mode: "auto", count: autoCount };
    } else {
      selection = { mode: "manual", personaIds: selectedIds };
    }
    const body: CouncilRequestBody = { selection, rounds };
    await sendMessage({ text }, { body });
  };

  return (
    <Flex direction="column" h={{ base: "auto", md: "100dvh" }} minH="100dvh">
      <HStack
        as="header"
        px={{ base: 4, md: 6 }}
        py="3"
        borderBottomWidth="1px"
        justify="space-between"
        flexShrink={0}
      >
        <Stack gap="0">
          <Heading size="md">Grok Council</Heading>
          <Text textStyle="xs" color="fg.muted">
            著名人に相談し、討論と総括を聞く
          </Text>
        </Stack>
        <ColorModeButton />
      </HStack>

      <Flex
        direction={{ base: "column", md: "row" }}
        flex="1"
        minH={{ md: 0 }}
      >
        <Box
          as="aside"
          w={{ base: "full", md: "360px" }}
          flexShrink={0}
          borderRightWidth={{ md: "1px" }}
          borderBottomWidth={{ base: "1px", md: 0 }}
          overflowY={{ md: "auto" }}
          px={{ base: 4, md: 5 }}
          py="5"
        >
          <Stack gap="6">
            <PersonaPicker
              personas={personas}
              mode={mode}
              onModeChange={setMode}
              selectedIds={selectedIds}
              onSelectedChange={setSelectedIds}
              autoCount={autoCount}
              onAutoCountChange={setAutoCount}
              routedIds={routedIds}
              rounds={rounds}
              onRoundsChange={setRounds}
              locked={started}
            />
            <Separator />
            <ConsultForm
              value={input}
              onChange={setInput}
              onSubmit={submit}
              onStop={stop}
              busy={busy}
              blockedReason={blockedReason}
              maxChars={councilConfig.limits.maxUserTextChars}
              label={started ? "追加質問" : "相談内容"}
              placeholder={
                started
                  ? "討論を聞いて気になったことを追加で質問できます"
                  : "相談したい内容を書いてください"
              }
            />
          </Stack>
        </Box>

        <Box as="main" flex="1" minW="0" overflowY={{ md: "auto" }} px={{ base: 4, md: 8 }} py="6">
          <Stack gap="4" maxW="860px" mx="auto">
            {requestErrorMessage && (
              <ErrorNotice
                title="リクエストを受け付けられませんでした"
                message={requestErrorMessage}
                fatal
                onReset={reset}
              />
            )}
            <Timeline messages={messages} status={status} onReset={reset} />
          </Stack>
        </Box>
      </Flex>
    </Flex>
  );
}
