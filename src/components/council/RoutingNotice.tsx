"use client";

import { Badge, Box, Collapsible, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Routing, RoutingCandidate, RoutingDebug } from "@/lib/types";

type Props = {
  routing: Routing;
};

function formatScore(c: RoutingCandidate): string {
  return `${c.score.toFixed(1)} / ${c.maxScore}`;
}

/** 確信度を % で。レスポンスに含まれていなければ「—」 */
function formatConfidence(confidence: number | undefined): string {
  return confidence == null ? "—" : `${Math.round(confidence * 100)}%`;
}

/** 確信度の色分け。typesafe.ai の目安（0.5 未満は人の確認へ）に合わせる */
function confidencePalette(confidence: number | undefined): string {
  if (confidence == null) return "gray";
  if (confidence >= 0.75) return "green";
  if (confidence >= 0.5) return "yellow";
  return "orange";
}

/** run の先頭に出す「誰が、どのくらいの適性で選ばれたか」の表示 */
export function RoutingNotice({ routing }: Props) {
  return (
    <Box
      bg="bg.subtle"
      borderWidth="1px"
      borderColor="border"
      borderStyle="dashed"
      rounded="md"
      px="4"
      py="3"
    >
      {!routing.done ? (
        <HStack color="fg.muted" textStyle="sm">
          <Spinner size="xs" />
          <Text>相談内容に合う回答者を {routing.count} 名選んでいます…</Text>
        </HStack>
      ) : (
        <Stack gap="2">
          {routing.candidates.length === 0 ? (
            <Text textStyle="sm" color="fg.muted">
              回答者の自動選定は完了しませんでした。
            </Text>
          ) : (
            <>
              <Text textStyle="xs" color="fg.muted">
                相談内容に対する適性を評価モデルが採点し、上位 {routing.count} 名を選びました。
                適性は 0〜{routing.candidates[0].maxScore} の段階評価の加重平均、確信度は判定の確率分布の尖り具合です。
              </Text>
              <Stack gap="1">
                {routing.candidates.map((c) => (
                  <CandidateRow key={c.personaId} candidate={c} />
                ))}
              </Stack>
            </>
          )}
          {routing.debug && <RoutingDebugPanel debug={routing.debug} model={routing.model} />}
        </Stack>
      )}
    </Box>
  );
}

function CandidateRow({ candidate: c }: { candidate: RoutingCandidate }) {
  const ratio = c.maxScore > 0 ? c.score / c.maxScore : 0;
  return (
    <HStack gap="3" opacity={c.selected ? 1 : 0.6} flexWrap="wrap">
      <HStack gap="2" minW="0" flex="1">
        <Text
          textStyle="sm"
          fontWeight={c.selected ? "semibold" : "normal"}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {c.name}
        </Text>
        {c.selected && (
          <Badge colorPalette={c.color} variant="subtle" size="sm" flexShrink={0}>
            参加
          </Badge>
        )}
      </HStack>
      <HStack gap="2" flexShrink={0}>
        <Box w="6rem" h="2" bg="bg.emphasized" rounded="full" overflow="hidden">
          <Box w={`${Math.round(ratio * 100)}%`} h="full" bg={`${c.color}.solid`} />
        </Box>
        <Text textStyle="xs" fontFamily="mono" w="4.5rem" textAlign="end">
          {formatScore(c)}
        </Text>
        <Badge colorPalette={confidencePalette(c.confidence)} variant="outline" size="sm" w="6.5rem" justifyContent="center">
          確信度 {formatConfidence(c.confidence)}
        </Badge>
      </HStack>
    </HStack>
  );
}

/** 評価モデルへの送受信をそのまま見せるデバッグ表示。config.routing.debug のときだけ出る */
function RoutingDebugPanel({ debug, model }: { debug: RoutingDebug; model: string }) {
  const totalMs = debug.calls.reduce((n, c) => n + c.elapsedMs, 0);
  const callLabel = debug.calls.length > 1 ? `${debug.calls.length} 回・` : "";
  return (
    <Collapsible.Root pt="1">
      <Collapsible.Trigger
        textStyle="xs"
        color="fg.muted"
        cursor="pointer"
        _hover={{ textDecoration: "underline" }}
      >
        <Collapsible.Context>
          {(api) =>
            `${api.open ? "▾" : "▸"} デバッグ: ${model} への送受信を${api.open ? "隠す" : "表示"}（${callLabel}${totalMs}ms）`
          }
        </Collapsible.Context>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Stack gap="4" pt="2">
          {debug.calls.map((call, i) => {
            const prefix = debug.calls.length > 1 ? `呼び出し ${i + 1} / ${debug.calls.length}: ` : "";
            return (
              <Stack key={i} gap="3">
                <DebugBlock
                  title={`${prefix}Request`}
                  body={JSON.stringify(call.request, null, 2)}
                />
                {call.response !== undefined && (
                  <DebugBlock
                    title={`${prefix}Response（${call.elapsedMs}ms）`}
                    body={JSON.stringify(call.response, null, 2)}
                  />
                )}
                {call.error && <DebugBlock title={`${prefix}Error`} body={call.error} error />}
              </Stack>
            );
          })}
        </Stack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function DebugBlock({ title, body, error = false }: { title: string; body: string; error?: boolean }) {
  return (
    <Stack gap="1">
      <Text textStyle="xs" fontWeight="semibold" color={error ? "fg.error" : "fg.muted"}>
        {title}
      </Text>
      <Box
        as="pre"
        fontFamily="mono"
        textStyle="xs"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        bg="bg"
        borderWidth="1px"
        borderColor={error ? "border.error" : "border"}
        rounded="sm"
        px="3"
        py="2"
        maxH="24rem"
        overflowY="auto"
      >
        {body}
      </Box>
    </Stack>
  );
}
