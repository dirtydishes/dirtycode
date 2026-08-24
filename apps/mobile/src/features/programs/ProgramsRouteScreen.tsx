import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { ProgramStatusTone } from "@t3tools/client-runtime/state/program-presentation";
import type { EnvironmentId } from "@t3tools/contracts";
import { Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { programEnvironment } from "../../state/programs";
import { useEnvironmentQuery } from "../../state/query";
import {
  buildMobileProgramIndexPresentation,
  type MobileProgramIndexRow,
} from "./programPresentation";

type ProgramsRouteProps = StaticScreenProps<{
  readonly environmentId: EnvironmentId;
}>;

function stateIndicatorClass(tone: ProgramStatusTone): string {
  if (tone === "success") return "bg-success";
  if (tone === "warning") return "bg-warning";
  if (tone === "danger") return "bg-danger";
  if (tone === "info") return "bg-primary";
  return "bg-foreground-tertiary";
}

function ProgramIndexRow(props: {
  readonly row: MobileProgramIndexRow;
  readonly onOpen: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.row.accessibilityLabel}
      accessibilityRole="button"
      onPress={props.onOpen}
      className="min-h-16 flex-row items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
    >
      <View
        aria-hidden
        className={cn("size-2.5 rounded-full", stateIndicatorClass(props.row.stateTone))}
      />
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={1} className="text-base font-t3-medium text-foreground">
          {props.row.title}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {props.row.stateLabel} · {props.row.phaseCount} phase
          {props.row.phaseCount === 1 ? "" : "s"} · {props.row.activeAgentCount} active
        </Text>
      </View>
      <Text aria-hidden className="text-xl text-foreground-tertiary">
        ›
      </Text>
    </Pressable>
  );
}

export function ProgramsRouteScreen({ route }: ProgramsRouteProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = route.params.environmentId;
  const live = useEnvironmentQuery(programEnvironment.live({ environmentId, input: {} }));
  const presentation =
    live.data === null
      ? null
      : buildMobileProgramIndexPresentation(environmentId, live.data.programs);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="dirtyloops" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        accessibilityLabel="dirtyloops Programs"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={live.isPending} onRefresh={live.refresh} />}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {live.error !== null && presentation === null ? (
          <View accessibilityRole="alert" className="rounded-[24px] border-continuous bg-card p-5">
            <Text className="text-base font-t3-medium text-foreground">
              Programs could not load
            </Text>
            <Text className="mt-1 text-sm leading-5 text-foreground-muted">{live.error}</Text>
            <Pressable
              accessibilityLabel="Retry loading Programs"
              accessibilityRole="button"
              onPress={live.refresh}
              className="mt-4 min-h-12 items-center justify-center rounded-full bg-primary px-5"
            >
              <Text className="font-t3-bold text-primary-foreground">Retry</Text>
            </Pressable>
          </View>
        ) : presentation === null ? (
          <Text
            accessibilityRole="text"
            className="py-16 text-center text-base text-foreground-muted"
          >
            Loading Programs…
          </Text>
        ) : presentation.count === 0 ? (
          <View className="items-center gap-2 py-16">
            <Text className="text-lg font-t3-bold text-foreground">No Programs yet</Text>
            <Text className="max-w-72 text-center text-sm leading-5 text-foreground-muted">
              Programs created by dirtyloops will appear here.
            </Text>
          </View>
        ) : (
          presentation.sections.map((section) => (
            <View key={section.title} className="gap-2">
              <Text className="px-2 text-sm font-t3-medium text-foreground-muted">
                {section.title}
              </Text>
              <View className="overflow-hidden rounded-[24px] border-continuous bg-card">
                {section.rows.map((row) => (
                  <ProgramIndexRow
                    key={row.programId}
                    row={row}
                    onOpen={() => navigation.navigate("Program", row.route)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
