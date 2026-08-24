import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProgramId,
  ProgramRequestId,
  type ProgramProjection,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { programEnvironment } from "../../state/programs";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import type { MobileProgramOperatorCommand } from "./programPresentation";
import { ProgramScreen, type ProgramCommandFeedback } from "./ProgramScreen";

type ProgramRouteProps = StaticScreenProps<{
  readonly environmentId: EnvironmentId;
  readonly programId: ProgramId;
}>;

let programCommandSequence = 0;

function readableIdentifier(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function newestProjection(
  ...projections: ReadonlyArray<ProgramProjection | null | undefined>
): ProgramProjection | null {
  return projections.reduce<ProgramProjection | null>(
    (newest, projection) =>
      projection !== null &&
      projection !== undefined &&
      (newest === null || projection.revision > newest.revision)
        ? projection
        : newest,
    null,
  );
}

export function ProgramRouteScreen({ route }: ProgramRouteProps) {
  const navigation = useNavigation();
  const { environmentId: environmentIdParam, programId: programIdParam } = route.params;
  const environmentId = EnvironmentId.make(String(environmentIdParam));
  const programId = ProgramId.make(String(programIdParam));
  const detail = useEnvironmentQuery(
    programEnvironment.detail({ environmentId, input: { programId } }),
  );
  const live = useEnvironmentQuery(programEnvironment.live({ environmentId, input: {} }));
  const mutate = useAtomCommand(programEnvironment.mutate, { reportFailure: false });
  const [pending, setPending] = useState<MobileProgramOperatorCommand | null>(null);
  const [feedback, setFeedback] = useState<ProgramCommandFeedback | null>(null);
  const [commandProjection, setCommandProjection] = useState<ProgramProjection | null>(null);
  const liveSummary = live.data?.programs.get(programId) ?? null;
  const liveProjection = live.data?.projections.get(programId) ?? null;
  const projection = newestProjection(detail.data?.projection, liveProjection, commandProjection);

  useEffect(() => {
    if (liveSummary !== null) detail.refresh();
  }, [liveSummary?.lastEventAt]);

  useEffect(() => {
    const observed = newestProjection(detail.data?.projection, liveProjection);
    if (
      commandProjection !== null &&
      observed !== null &&
      observed.revision >= commandProjection.revision
    ) {
      setCommandProjection(null);
    }
  }, [commandProjection, detail.data, liveProjection]);

  const runCommand = async (command: MobileProgramOperatorCommand) => {
    setPending(command);
    setFeedback(null);
    const requestId = ProgramRequestId.make(
      `request:mobile:${programId}:${command}:${Date.now()}:${++programCommandSequence}`,
    );
    const input =
      command === "stop"
        ? { programId, requestId, reason: "Stopped from the mobile Program workspace." }
        : { programId, requestId };
    const result = await mutate({ environmentId, input: { kind: command, input } });
    setPending(null);
    if (result._tag === "Success") {
      setCommandProjection(result.value.projection);
      setFeedback(result.value.decision);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setFeedback({
        status: "failed",
        code: "transport_error",
        message: error instanceof Error ? error.message : "The Program command failed.",
      });
    }
  };

  const confirmCommand = (command: MobileProgramOperatorCommand) => {
    if (command !== "stop") {
      void runCommand(command);
      return;
    }
    Alert.alert(
      "Stop Program?",
      "The runtime will stop at its safe boundary. Completed work and receipts remain available.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Stop Program", style: "destructive", onPress: () => void runCommand("stop") },
      ],
    );
  };

  const refresh = () => {
    detail.refresh();
    live.refresh();
  };
  const initialError = projection === null ? (detail.error ?? live.error) : null;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title={projection?.title ?? "Program"}
            subtitle={projection === null ? null : readableIdentifier(projection.state)}
            onBack={() => navigation.goBack()}
          />
        </>
      ) : (
        <NativeStackScreenOptions options={{ title: projection?.title ?? "Program" }} />
      )}
      {projection === null ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Text
            accessibilityRole={initialError === null ? "text" : "alert"}
            className="text-center text-base text-foreground-muted"
          >
            {initialError ??
              (detail.isPending || live.isPending ? "Loading Program…" : "Program not found.")}
          </Text>
          {initialError !== null ? (
            <Pressable
              accessibilityLabel="Retry loading Program"
              accessibilityRole="button"
              onPress={refresh}
              className="min-h-12 items-center justify-center rounded-full bg-primary px-5"
            >
              <Text className="font-t3-bold text-primary-foreground">Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ProgramScreen
          projection={projection}
          pending={pending}
          feedback={feedback}
          staleMessage={detail.error ?? live.error}
          refreshing={detail.isPending || live.isPending}
          onRefresh={refresh}
          onCommand={confirmCommand}
        />
      )}
    </View>
  );
}
