"use client";

import { Alert, Button } from "@chakra-ui/react";

type Props = {
  message: string;
  title?: string;
  fatal?: boolean;
  /** fatal のときに表示する「最初からやり直す」ボタン */
  onReset?: () => void;
  size?: "sm" | "md";
};

export function ErrorNotice({ message, title, fatal = false, onReset, size = "md" }: Props) {
  return (
    <Alert.Root status={fatal ? "error" : "warning"} size={size} alignItems="center">
      <Alert.Indicator />
      <Alert.Content>
        {title && <Alert.Title>{title}</Alert.Title>}
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
      {fatal && onReset && (
        <Button size="sm" variant="outline" colorPalette="red" onClick={onReset} flexShrink={0}>
          最初からやり直す
        </Button>
      )}
    </Alert.Root>
  );
}

/**
 * useChat の error.message から表示用の文言を取り出す。
 * サーバーが 400 を返した場合、message はレスポンス本文の JSON 文字列そのものになる。
 */
export function describeChatError(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // JSON でなければそのまま扱う
  }
  if (/failed to fetch/i.test(error.message)) {
    return "サーバーに接続できませんでした。開発サーバーが起動しているか確認してください。";
  }
  return error.message || "不明なエラーが発生しました。";
}
