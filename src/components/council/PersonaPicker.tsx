"use client";

import { Badge, Checkbox, Heading, HStack, NativeSelect, Stack, Switch, Text } from "@chakra-ui/react";
import { councilConfig } from "@/config/council";
import type { Persona } from "@/lib/types";

export type SelectionMode = "manual" | "auto";

type Props = {
  personas: readonly Persona[];
  mode: SelectionMode;
  onModeChange: (mode: SelectionMode) => void;
  /** manual のときに利用者が選んだ ID */
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  /** auto のときに選ぶ人数 */
  autoCount: number;
  onAutoCountChange: (count: number) => void;
  /** auto で実際に選ばれた ID（初回 run の結果）。まだなければ空 */
  routedIds: string[];
  rounds: number;
  onRoundsChange: (rounds: number) => void;
  /** 初回送信後は参加者を変更できない */
  locked: boolean;
};

export function PersonaPicker({
  personas,
  mode,
  onModeChange,
  selectedIds,
  onSelectedChange,
  autoCount,
  onAutoCountChange,
  routedIds,
  rounds,
  onRoundsChange,
  locked,
}: Props) {
  const { minPersonas, maxPersonas, minRounds, maxRounds } = councilConfig;
  const auto = mode === "auto";
  const full = selectedIds.length >= maxPersonas;

  // 画面上でチェックが付く ID。auto のときは選定結果を映す
  const checkedIds = auto ? routedIds : selectedIds;

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (selectedIds.includes(id) || full) return;
      onSelectedChange([...selectedIds, id]);
    } else {
      onSelectedChange(selectedIds.filter((x) => x !== id));
    }
  };

  const roundOptions: number[] = [];
  for (let r = minRounds; r <= maxRounds; r++) roundOptions.push(r);

  const countOptions: number[] = [];
  for (let n = minPersonas; n <= Math.min(maxPersonas, personas.length); n++) countOptions.push(n);

  let hint: string;
  if (auto) {
    if (locked && routedIds.length > 0) {
      hint = `相談内容に合わせて ${routedIds.length} 名が選ばれました — 討論開始後は変更できません`;
    } else if (locked) {
      hint = "相談内容に合う回答者を選んでいます…";
    } else {
      hint = `送信すると、相談内容に合う ${autoCount} 名を全 ${personas.length} 名の中から自動で選びます`;
    }
  } else {
    hint = `${minPersonas}〜${maxPersonas} 名を選択（${selectedIds.length} 名選択中）${
      locked ? " — 討論開始後は変更できません" : ""
    }`;
  }

  return (
    <Stack gap="5">
      <Stack gap="3">
        <Heading size="sm">参加する著名人</Heading>

        <Switch.Root
          size="sm"
          checked={auto}
          disabled={locked}
          onCheckedChange={(e) => onModeChange(e.checked ? "auto" : "manual")}
        >
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label>相談内容に合わせて自動で選ぶ</Switch.Label>
        </Switch.Root>

        {auto && (
          <HStack gap="3">
            <Text textStyle="sm" flexShrink={0}>
              人数
            </Text>
            <NativeSelect.Root size="sm" disabled={locked} maxW="8rem">
              <NativeSelect.Field
                value={String(autoCount)}
                onChange={(e) => onAutoCountChange(Number(e.currentTarget.value))}
              >
                {countOptions.map((n) => (
                  <option key={n} value={n}>
                    {n} 名
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
        )}

        <Text textStyle="xs" color="fg.muted">
          {hint}
        </Text>

        <Stack gap="2">
          {personas.map((p) => {
            const checked = checkedIds.includes(p.id);
            return (
              <Checkbox.Root
                key={p.id}
                colorPalette={p.color}
                checked={checked}
                disabled={auto || locked || (!checked && full)}
                onCheckedChange={(e) => toggle(p.id, e.checked === true)}
                alignItems="flex-start"
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control mt="1" />
                <Checkbox.Label>
                  <Stack gap="0">
                    <HStack gap="2">
                      <Text>{p.name}</Text>
                      {auto && checked && (
                        <Badge colorPalette={p.color} variant="subtle" size="sm">
                          自動選定
                        </Badge>
                      )}
                    </HStack>
                    <Text textStyle="xs" color="fg.muted" fontWeight="normal">
                      {p.title}
                    </Text>
                  </Stack>
                </Checkbox.Label>
              </Checkbox.Root>
            );
          })}
        </Stack>
      </Stack>

      <Stack gap="2">
        <Heading size="sm">討論のラウンド数</Heading>
        <NativeSelect.Root size="sm" disabled={locked}>
          <NativeSelect.Field
            value={String(rounds)}
            onChange={(e) => onRoundsChange(Number(e.currentTarget.value))}
          >
            {roundOptions.map((r) => (
              <option key={r} value={r}>
                {r} ラウンド
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Text textStyle="xs" color="fg.muted">
          呼び出し回数 = 人数 × (1 + ラウンド数) + 総括 1 回。人数とラウンドが増えるほど時間がかかります。
        </Text>
      </Stack>
    </Stack>
  );
}
