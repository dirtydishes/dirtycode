import type { ProgramProjection } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import type { MobileProgramPresentation } from "./programPresentation";

export type ProgramTab = "overview" | "phases" | "teams" | "activity";

function readableIdentifier(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function ProgramCard(props: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={props.accessibilityLabel}
      className="gap-3 rounded-[24px] border-continuous bg-card p-4"
    >
      <Text className="text-sm font-t3-medium text-foreground-muted">{props.title}</Text>
      {props.children}
    </View>
  );
}

function OverviewTab(props: {
  readonly projection: ProgramProjection;
  readonly presentation: MobileProgramPresentation;
}) {
  const deliberations = (props.projection.deliberations ?? []).toReversed().slice(0, 8);
  return (
    <>
      <ProgramCard title="Program budget" accessibilityLabel="Program budget">
        {props.presentation.budgetRows.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No aggregate budget reported.</Text>
        ) : (
          <View className="gap-2">
            {props.presentation.budgetRows.map((row) => (
              <View
                key={row.key}
                accessibilityLabel={`${row.label} ${row.valueLabel}${row.exhausted ? ", exhausted" : ""}`}
                className="flex-row items-center justify-between gap-4"
              >
                <Text
                  className={cn(
                    "text-sm",
                    row.exhausted ? "text-danger-foreground" : "text-foreground-muted",
                  )}
                >
                  {row.label}
                </Text>
                <Text className="text-sm font-t3-medium tabular-nums text-foreground">
                  {row.valueLabel}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ProgramCard>

      {props.presentation.evaluationRows.length > 0 ? (
        <ProgramCard
          title="Evaluation comparison"
          accessibilityLabel="Program evaluation comparison"
        >
          <Text className="text-sm leading-5 text-foreground-muted">
            {props.presentation.evaluationGuidance}
          </Text>
          {props.presentation.evaluationRows.map((evaluation) => (
            <View
              key={evaluation.evaluationId}
              accessibilityLabel={`${evaluation.armLabel}. ${evaluation.acceptedLabel}. ${evaluation.timeLabel}. ${evaluation.resourceLabel}. ${evaluation.qualityLabel}. ${evaluation.safetyLabel}. ${evaluation.recoveryLabel}. ${evaluation.throughputLabel}.`}
              className="gap-1.5 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <View className="flex-row items-start justify-between gap-3">
                <Text className="min-w-0 flex-1 text-base font-t3-medium text-foreground">
                  {evaluation.armLabel}
                </Text>
                <Text className="text-sm font-t3-medium tabular-nums text-foreground">
                  {evaluation.acceptedLabel}
                </Text>
              </View>
              <Text className="text-xs text-foreground-muted">{evaluation.timeLabel}</Text>
              <Text className="text-xs text-foreground-muted">{evaluation.resourceLabel}</Text>
              <Text className="text-xs text-foreground-muted">{evaluation.qualityLabel}</Text>
              <Text className="text-xs text-foreground-muted">{evaluation.safetyLabel}</Text>
              <Text className="text-xs text-foreground-muted">{evaluation.recoveryLabel}</Text>
              <Text className="text-xs text-foreground-muted">{evaluation.throughputLabel}</Text>
            </View>
          ))}
        </ProgramCard>
      ) : null}

      <ProgramCard title="Deliberation" accessibilityLabel="Program deliberations">
        {deliberations.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No deliberation recorded.</Text>
        ) : (
          deliberations.map((deliberation) => (
            <View
              key={deliberation.deliberationId}
              className="gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <Text className="text-base font-t3-medium text-foreground">
                {deliberation.question}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {readableIdentifier(deliberation.state)} ·{" "}
                {deliberation.participantThreadIds.length} participant
                {deliberation.participantThreadIds.length === 1 ? "" : "s"}
              </Text>
              {deliberation.entries.at(-1)?.summary ? (
                <Text className="text-sm leading-5 text-foreground">
                  {deliberation.entries.at(-1)?.summary}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ProgramCard>

      <ProgramCard
        title="Receipts"
        accessibilityLabel={`${props.presentation.window.receipts.total} Program receipts`}
      >
        {props.presentation.window.receipts.items.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No receipts recorded.</Text>
        ) : (
          props.presentation.window.receipts.items.map((receipt) => (
            <View
              key={receipt.receiptId}
              className="gap-0.5 border-b border-border pb-2 last:border-b-0 last:pb-0"
            >
              <Text className="text-sm font-t3-medium text-foreground">
                {readableIdentifier(receipt.kind)}
              </Text>
              <Text numberOfLines={1} className="font-mono text-xs text-foreground-muted">
                {receipt.receiptId}
              </Text>
            </View>
          ))
        )}
        {props.presentation.window.receipts.total >
        props.presentation.window.receipts.items.length ? (
          <Text className="text-xs text-foreground-tertiary">
            Showing newest {props.presentation.window.receipts.items.length.toLocaleString("en-US")}{" "}
            of {props.presentation.window.receipts.total.toLocaleString("en-US")}
          </Text>
        ) : null}
      </ProgramCard>
    </>
  );
}

function PhasesTab(props: { readonly presentation: MobileProgramPresentation }) {
  return (
    <ProgramCard title="Phase graph, linear view" accessibilityLabel="Program Phase graph">
      {props.presentation.window.phases.items.map((phase, index) => (
        <View
          key={phase.phaseId}
          className="flex-row gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
        >
          <View className="size-8 items-center justify-center rounded-full bg-subtle">
            <Text className="text-xs font-t3-bold tabular-nums text-foreground">{index + 1}</Text>
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base font-t3-medium text-foreground">{phase.title}</Text>
            <Text className="text-sm text-foreground-muted">
              {readableIdentifier(phase.state)}
              {phase.blockedBy.length > 0 ? ` · ${phase.blockedBy.length} blockers` : ""}
            </Text>
          </View>
        </View>
      ))}
      {props.presentation.window.phases.total > props.presentation.window.phases.items.length ? (
        <Text className="text-xs text-foreground-tertiary">
          Showing {props.presentation.window.phases.items.length} of{" "}
          {props.presentation.window.phases.total.toLocaleString("en-US")} Phases
        </Text>
      ) : null}
    </ProgramCard>
  );
}

function TeamsTab(props: { readonly presentation: MobileProgramPresentation }) {
  return (
    <ProgramCard title="Accountable owner teams" accessibilityLabel="Program owner teams">
      {props.presentation.teamRows.length === 0 ? (
        <Text className="text-sm text-foreground-muted">No team policy reported.</Text>
      ) : (
        props.presentation.teamRows.map((team) => (
          <View
            key={team.attemptId}
            className="gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
          >
            <Text className="text-base font-t3-medium text-foreground">{team.modeLabel}</Text>
            <Text className="text-sm text-foreground-muted">
              {team.boundsLabel ?? "One accountable owner"}
            </Text>
            {team.criteria.length > 0 ? (
              <Text className="text-sm leading-5 text-foreground">
                Criteria: {team.criteria.join(", ")}
              </Text>
            ) : null}
          </View>
        ))
      )}
      {props.presentation.window.attempts.total >
      props.presentation.window.attempts.items.length ? (
        <Text className="text-xs text-foreground-tertiary">
          Showing {props.presentation.window.attempts.items.length} of{" "}
          {props.presentation.window.attempts.total.toLocaleString("en-US")} Attempts
        </Text>
      ) : null}
    </ProgramCard>
  );
}

function ActivityTab(props: { readonly presentation: MobileProgramPresentation }) {
  return (
    <ProgramCard title="Newest activity" accessibilityLabel="Program activity">
      {props.presentation.window.activity.items.length === 0 ? (
        <Text className="text-sm text-foreground-muted">No activity recorded.</Text>
      ) : (
        props.presentation.window.activity.items.map((activity) => (
          <View
            key={activity.eventId}
            className="gap-0.5 border-b border-border pb-3 last:border-b-0 last:pb-0"
          >
            <Text className="text-sm leading-5 text-foreground">{activity.message}</Text>
            <Text className="text-xs text-foreground-muted">
              {readableIdentifier(activity.kind)} · {new Date(activity.occurredAt).toLocaleString()}
            </Text>
          </View>
        ))
      )}
      {props.presentation.window.activity.total >
      props.presentation.window.activity.items.length ? (
        <Text className="text-xs text-foreground-tertiary">
          Showing newest {props.presentation.window.activity.items.length} of{" "}
          {props.presentation.window.activity.total.toLocaleString("en-US")}
        </Text>
      ) : null}
    </ProgramCard>
  );
}

export function ProgramTabContent(props: {
  readonly tab: ProgramTab;
  readonly projection: ProgramProjection;
  readonly presentation: MobileProgramPresentation;
}) {
  if (props.tab === "overview") {
    return <OverviewTab projection={props.projection} presentation={props.presentation} />;
  }
  if (props.tab === "phases") return <PhasesTab presentation={props.presentation} />;
  if (props.tab === "teams") return <TeamsTab presentation={props.presentation} />;
  return <ActivityTab presentation={props.presentation} />;
}
