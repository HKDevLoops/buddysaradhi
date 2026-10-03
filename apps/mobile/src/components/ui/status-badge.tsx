// Implements: docs/design/overhaul-plan.md §6 — token-backed status chip.
//
// Every status maps to a token ROLE (success / warning / danger / info /
// accent / text-muted). There is no per-status colour literal here, which is why
// a new fee or attendance state cannot invent a colour: it has to pick a role
// that already passed the contrast gate.
//
// The chip background is the opaque inset well, not a tint of the status colour.
// material-modes.md §1.1: translucency belongs to floating surfaces, never to a
// row or a chip inside a dense list.
import { Text, View } from "react-native";
import type { ViewProps } from "react-native";

import { useThemeStyles } from "../../theme/styles";

export type StatusType =
  | "paid" | "partial" | "unpaid" | "overdue" | "no_dues"
  | "present" | "absent" | "late" | "excused" | "holiday"
  | "postpaid" | "prepaid" | "mixed"
  | "active" | "inactive" | "graduated" | "archived";

type StatusRole = "success" | "warning" | "danger" | "info" | "accent" | "neutral";

const STATUS: Readonly<Record<StatusType, { role: StatusRole; label: string }>> = {
  paid: { role: "success", label: "Paid" },
  present: { role: "success", label: "Present" },
  postpaid: { role: "success", label: "Postpaid" },
  active: { role: "success", label: "Active" },

  partial: { role: "warning", label: "Partial" },
  late: { role: "warning", label: "Late" },
  prepaid: { role: "warning", label: "Prepaid" },

  unpaid: { role: "danger", label: "Unpaid" },
  absent: { role: "danger", label: "Absent" },
  overdue: { role: "danger", label: "Overdue" },

  excused: { role: "info", label: "Excused" },
  holiday: { role: "info", label: "Holiday" },
  mixed: { role: "accent", label: "Mixed" },

  inactive: { role: "neutral", label: "Inactive" },
  graduated: { role: "neutral", label: "Graduated" },
  archived: { role: "neutral", label: "Archived" },
  no_dues: { role: "neutral", label: "No Dues" },
};

interface StatusBadgeProps extends ViewProps {
  status: StatusType;
  label?: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, label, size = "md", className, ...props }: StatusBadgeProps) {
  const s = useThemeStyles();
  const config = STATUS[status] ?? STATUS.no_dues;
  const padding = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  const tone =
    config.role === "success"
      ? s.accent.success
      : config.role === "warning"
        ? s.accent.warning
        : config.role === "danger"
          ? s.accent.danger
          : config.role === "info"
            ? s.accent.info
            : config.role === "accent"
              ? s.fg.accent
              : s.fg.secondary;

  return (
    <View
      className={`rounded-full flex-row items-center justify-center ${padding} ${className ?? ""}`}
      style={[s.bg.inset, s.border.hairline, props.style]}
      {...props}
    >
      <Text className={`font-medium ${textSize}`} style={tone}>
        {label ?? config.label}
      </Text>
    </View>
  );
}