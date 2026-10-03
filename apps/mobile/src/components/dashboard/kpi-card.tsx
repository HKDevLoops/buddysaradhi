// Implements: docs/design/overhaul-plan.md §6 — token-backed KPI card.
//
// The `accent` prop used to name colours that were not in any token system
// (`emerald`, `cyan`, `flare`, `amber`, `violet`). It now names a token ROLE, so
// the value comes from the palette that is actually active.
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { TextStyle } from "react-native";

import { useThemeStyles } from "../../theme/styles";
import { GlassCard } from "../ui/glass-card";

type AccentRole = "success" | "info" | "warning" | "danger" | "accent";

function AnimatedCounter({
  value,
  isCurrency = false,
  tone,
}: {
  value: number;
  isCurrency?: boolean;
  tone: TextStyle;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValue = useRef(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    if (start === end) {
      setDisplayValue(end);
      return;
    }

    let startTime: number | null = null;
    const duration = 400;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayValue(Math.floor(start + (end - start) * eased));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        setDisplayValue(end);
        prevValue.current = end;
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value]);

  const formatted = isCurrency
    ? `₹ ${(displayValue / 100).toLocaleString("en-IN", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })}`
    : displayValue.toString();

  return (
    <Text className="text-2xl font-bold font-mono tracking-tight" style={tone}>
      {formatted}
    </Text>
  );
}

interface KpiCardProps {
  label: string;
  valueMinor?: number;
  valueCount?: number;
  deltaPct?: number;
  deltaLabel?: string;
  caption?: string;
  accent: AccentRole;
  empty?: boolean;
}

export function KpiCard({
  label,
  valueMinor,
  valueCount,
  deltaPct,
  deltaLabel,
  caption,
  accent,
  empty,
}: KpiCardProps) {
  const s = useThemeStyles();
  const tone =
    accent === "success"
      ? s.accent.success
      : accent === "info"
        ? s.accent.info
        : accent === "warning"
          ? s.accent.warning
          : accent === "danger"
            ? s.accent.danger
            : s.fg.accent;

  const valueToAnimate = valueMinor ?? valueCount ?? 0;
  const isCurrency = valueMinor !== undefined;

  return (
    <GlassCard intensity="strong" className="p-4 flex-col justify-between min-w-[280px] h-32 mr-3">
      <View>
        <Text className="text-xs font-semibold uppercase tracking-wider mb-2" style={s.fg.secondary}>
          {label}
        </Text>
        {empty ? (
          <Text className="text-2xl font-bold font-mono tracking-tight" style={tone}>
            {isCurrency ? "₹ 0.00" : "0"}
          </Text>
        ) : (
          <AnimatedCounter value={valueToAnimate} isCurrency={isCurrency} tone={tone} />
        )}
      </View>

      <View className="mt-2">
        {caption ? (
          <Text className="text-[10px]" style={s.fg.muted}>
            {caption}
          </Text>
        ) : deltaPct !== undefined && deltaLabel ? (
          <View className="flex-row items-center">
            <Text
              className="text-xs font-medium mr-1"
              style={deltaPct >= 0 ? s.accent.success : s.accent.danger}
            >
              {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct)}%
            </Text>
            <Text className="text-xs" style={s.fg.muted}>
              {deltaLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </GlassCard>
  );
}