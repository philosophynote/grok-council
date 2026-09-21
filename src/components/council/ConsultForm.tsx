"use client";

import { Button, HStack, Stack, Text, Textarea } from "@chakra-ui/react";
import { useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onStop: () => void;
  /** 送信中（submitted / streaming） */
  busy: boolean;
  /** 送信できない理由。あれば送信ボタンを無効化して表示する */
  blockedReason?: string;
  maxChars: number;
  label: string;
  placeholder: string;
};

export function ConsultForm({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  blockedReason,
  maxChars,
  label,
  placeholder,
}: Props) {
  // status の更新を待たずに連打を防ぐためのガード
  const submittingRef = useRef(false);

  const length = value.length;
  const over = length > maxChars;
  const empty = value.trim().length === 0;
  const disabled = busy || !!blockedReason || empty || over;

  const submit = async () => {
    if (disabled || submittingRef.current) return;
    submittingRef.current = true;
    try {
      await onSubmit();
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Stack gap="2">
        <Text fontWeight="semibold" textStyle="sm">
          {label}
        </Text>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          autoresize
          minH="6lh"
          maxH="14lh"
          disabled={busy || !!blockedReason}
        />
        <HStack justify="space-between" align="center">
          <Text textStyle="xs" color={over ? "fg.error" : "fg.muted"}>
            {length.toLocaleString()} / {maxChars.toLocaleString()} 字
          </Text>
          <HStack>
            {busy && (
              <Button type="button" variant="outline" colorPalette="red" size="sm" onClick={onStop}>
                停止
              </Button>
            )}
            <Button type="submit" size="sm" disabled={disabled} loading={busy} loadingText="討論中">
              送信
            </Button>
          </HStack>
        </HStack>
        {blockedReason && !busy && (
          <Text textStyle="xs" color="fg.muted">
            {blockedReason}
          </Text>
        )}
        <Text textStyle="xs" color="fg.muted">
          ⌘/Ctrl + Enter でも送信できます
        </Text>
      </Stack>
    </form>
  );
}
