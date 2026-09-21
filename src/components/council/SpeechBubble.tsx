"use client";

import { Avatar, Badge, Box, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Speech } from "@/lib/types";

type Props = {
  speech: Speech;
  /** このターンに紐づくエラーがあれば表示する */
  errorMessage?: string;
};

export function SpeechBubble({ speech, errorMessage }: Props) {
  const thinking = !speech.done && speech.text.length === 0;
  const streaming = !speech.done && speech.text.length > 0;

  return (
    <HStack align="flex-start" gap="3">
      <Avatar.Root colorPalette={speech.color} size="sm" flexShrink={0}>
        <Avatar.Fallback name={speech.name} />
      </Avatar.Root>
      <Stack gap="1" flex="1" minW="0">
        <HStack gap="2" flexWrap="wrap">
          <Text fontWeight="semibold">{speech.name}</Text>
          <Text textStyle="xs" color="fg.muted">
            {speech.title}
          </Text>
          {speech.aborted && (
            <Badge colorPalette="orange" variant="subtle" size="sm">
              中断
            </Badge>
          )}
          {errorMessage && !speech.aborted && (
            <Badge colorPalette="red" variant="subtle" size="sm">
              失敗
            </Badge>
          )}
        </HStack>
        <Box
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border"
          borderStartWidth="3px"
          borderStartColor={`${speech.color}.solid`}
          rounded="md"
          px="4"
          py="3"
        >
          {thinking ? (
            <HStack color="fg.muted" textStyle="sm">
              <Spinner size="xs" />
              <Text>{speech.name}が考えています…</Text>
            </HStack>
          ) : (
            <Text whiteSpace="pre-wrap" lineHeight="tall">
              {speech.text}
              {streaming && (
                <Box as="span" display="inline-block" ms="2" verticalAlign="middle">
                  <Spinner size="xs" />
                </Box>
              )}
            </Text>
          )}
          {errorMessage && (
            <Text mt="2" textStyle="sm" color="fg.error">
              {errorMessage}
            </Text>
          )}
        </Box>
      </Stack>
    </HStack>
  );
}
