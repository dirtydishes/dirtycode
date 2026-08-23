import type { ProgramCommandDecision, ProgramProjection } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import {
  buildMobileProgramPresentation,
  type MobileProgramControl,
  type MobileProgramOperatorCommand,
} from "./programPresentation";
import { ProgramTabContent, type ProgramTab } from "./ProgramScreenSections";

export type ProgramCommandFeedback =
  | ProgramCommandDecision
  | { readonly status: "failed"; readonly code: "transport_error"; readonly message: string };

function readableIdentifier(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function ProgramTabs(props: {
  readonly selected: ProgramTab;
  readonly onSelect: (tab: ProgramTab) => void;
}) {
  const tabs = [
    ["overview", "Overview"],
    ["phases", "Phases"],
    ["teams", "Teams"],
    ["activity", "Activity"],
  ] as const;
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-full bg-subtle p-1">
      {tabs.map(([tab, label]) => {
        const selected = props.selected === tab;
        return (
          <Pressable
            key={tab}
            accessibilityLabel={`${label} tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(tab)}
            className={cn(
              "min-h-11 flex-1 items-center justify-center rounded-full px-2",
              selected && "bg-card",
            )}
          >
            <Text
              className={cn(
                "text-xs font-t3-medium",
                selected ? "text-foreground" : "text-foreground-muted",
              )}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProgramControls(props: {
  readonly controls: ReadonlyArray<MobileProgramControl>;
  readonly pending: MobileProgramOperatorCommand | null;
  readonly onCommand: (command: MobileProgramOperatorCommand) => void;
}) {
  if (props.controls.length === 0) return null;
  return (
    <View accessibilityLabel="Program controls" className="flex-row flex-wrap gap-2">
      {props.controls.map((control) => (
        <Pressable
          key={control.command}
          accessibilityLabel={control.accessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: props.pending !== null }}
          disabled={props.pending !== null}
          onPress={() => props.onCommand(control.command)}
          className={cn(
            "min-h-12 min-w-28 items-center justify-center rounded-full border px-5",
            control.destructive ? "border-danger-border bg-danger" : "border-border bg-subtle",
            props.pending !== null && "opacity-50",
          )}
        >
          <Text
            className={cn(
              "font-t3-bold",
              control.destructive ? "text-danger-foreground" : "text-foreground",
            )}
          >
            {props.pending === control.command ? `${control.label}…` : control.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ProgramScreen(props: {
  readonly projection: ProgramProjection;
  readonly pending: MobileProgramOperatorCommand | null;
  readonly feedback: ProgramCommandFeedback | null;
  readonly staleMessage: string | null;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly onCommand: (command: MobileProgramOperatorCommand) => void;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<ProgramTab>("overview");
  const presentation = useMemo(
    () => buildMobileProgramPresentation(props.projection),
    [props.projection],
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} />}
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-4 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <Text className="rounded-full bg-subtle px-2.5 py-1 text-xs font-t3-medium text-foreground-muted">
            {readableIdentifier(props.projection.state)}
          </Text>
          <Text className="text-xs text-foreground-tertiary">
            revision {props.projection.revision}
          </Text>
        </View>
        <Text
          accessibilityRole="header"
          className="text-3xl font-t3-bold tracking-tight text-foreground"
        >
          {props.projection.title}
        </Text>
        <Text className="text-base leading-6 text-foreground-muted">
          {props.projection.outcome}
        </Text>
      </View>

      <ProgramControls
        controls={presentation.controls}
        pending={props.pending}
        onCommand={props.onCommand}
      />

      {props.feedback !== null ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={props.feedback.status === "accepted" ? "text" : "alert"}
          className={cn(
            "rounded-[18px] border px-4 py-3",
            props.feedback.status === "accepted"
              ? "border-success/30 bg-success/10"
              : "border-danger-border bg-danger",
          )}
        >
          <Text
            className={
              props.feedback.status === "accepted" ? "text-foreground" : "text-danger-foreground"
            }
          >
            {props.feedback.message}
          </Text>
        </View>
      ) : props.staleMessage !== null ? (
        <View
          accessibilityLiveRegion="polite"
          className="rounded-[18px] border border-warning/30 bg-warning/10 px-4 py-3"
        >
          <Text className="text-sm text-foreground">{props.staleMessage}</Text>
        </View>
      ) : null}

      <ProgramTabs selected={tab} onSelect={setTab} />
      <ProgramTabContent tab={tab} projection={props.projection} presentation={presentation} />
    </ScrollView>
  );
}
