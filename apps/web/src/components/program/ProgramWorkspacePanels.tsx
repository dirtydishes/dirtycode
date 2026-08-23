import type { ProgramEvaluationArm, ProgramProjection } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import type { ProgramWorkspacePage } from "@t3tools/client-runtime/state/programs";

type ProgramBudgetUsageKey = Exclude<
  keyof NonNullable<ProgramProjection["budgets"]>,
  "dispatchAllowed" | "exhausted"
>;

const PROGRAM_BUDGET_LABELS = [
  ["activeThreads", "Active threads"],
  ["nativeHelpers", "Native helpers"],
  ["helperDepth", "Helper depth"],
  ["providerTurns", "Provider turns"],
  ["tokens", "Tokens"],
  ["costMilliUsd", "Cost, milli-USD"],
  ["wallClockMinutes", "Time, minutes"],
  ["actions", "Actions"],
  ["concurrentWorktrees", "Worktrees"],
  ["cpuMillis", "CPU, ms"],
  ["memoryMiB", "Memory, MiB"],
  ["diskMiB", "Disk, MiB"],
  ["repairs", "Repairs"],
  ["retries", "Retries"],
] as const satisfies ReadonlyArray<readonly [ProgramBudgetUsageKey, string]>;

const PROGRAM_EVALUATION_ARM_LABELS: Readonly<Record<ProgramEvaluationArm, string>> = {
  solo: "Solo",
  explicit_delegates: "Explicit delegates",
  native_collaborative: "Native collaborative",
  t3_cross_provider: "T3 cross-provider",
  layered_dirtyloops_t3: "Layered dirtyloops + T3",
};

function readableCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function readableDurationMillis(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value / 1_000)} s`;
}

function readableMilliUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(value / 1_000);
}

function readableIdentifier(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function ProgramWindowControls<T>(props: {
  readonly noun: string;
  readonly page: ProgramWorkspacePage<T>;
  readonly pageSize: number;
  readonly onOffsetChange: (offset: number) => void;
}) {
  if (props.page.total <= props.pageSize) return null;
  const first = props.page.offset + 1;
  const last = props.page.offset + props.page.items.length;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <span className="text-[11px] text-muted-foreground" role="status">
        Showing {props.noun} {readableCount(first)}–{readableCount(last)} of{" "}
        {readableCount(props.page.total)}
      </span>
      <div className="flex items-center gap-1">
        <Button
          aria-label={`Previous ${props.noun}`}
          disabled={!props.page.hasPrevious}
          onClick={() => props.onOffsetChange(Math.max(0, props.page.offset - props.pageSize))}
          size="icon-sm"
          variant="ghost-muted"
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Button
          aria-label={`Next ${props.noun}`}
          disabled={!props.page.hasNext}
          onClick={() => props.onOffsetChange(props.page.offset + props.pageSize)}
          size="icon-sm"
          variant="ghost-muted"
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function ProgramAttemptTeamPolicy(props: {
  readonly policy: NonNullable<ProgramProjection["attempts"][number]["teamPolicy"]>;
}) {
  const { policy } = props;
  return (
    <div className="mt-3 border-t border-border pt-2 text-xs">
      <p className="font-medium">{readableIdentifier(policy.mode)}</p>
      <p className="mt-1 text-muted-foreground">
        {policy.mode === "solo"
          ? "No helpers"
          : `${readableCount(policy.maxHelpers)} helpers · ${readableCount(policy.maxConcurrent)} concurrent · depth ${readableCount(policy.maxDepth)}`}
      </p>
      {policy.mode === "layered_hybrid" ? (
        <p className="mt-1 text-muted-foreground">
          {readableCount(policy.maxRounds)} rounds · {policy.criteria.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export function ProgramDeliberations(props: {
  readonly deliberations: NonNullable<ProgramProjection["deliberations"]>;
}) {
  if (props.deliberations.length === 0) return null;
  return (
    <section
      aria-labelledby="program-deliberations"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="program-deliberations" className="text-sm font-semibold">
          Deliberation
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {readableCount(props.deliberations.length)} retained
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {props.deliberations
          .slice(-8)
          .toReversed()
          .map((deliberation) => {
            const latest = deliberation.entries.at(-1);
            return (
              <li key={deliberation.deliberationId} className="py-3 first:pt-1 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">{deliberation.question}</p>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
                    {readableIdentifier(deliberation.state)}
                  </span>
                </div>
                {latest ? (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{latest.summary}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {readableCount(deliberation.participantThreadIds.length)} participants ·{" "}
                  {readableCount(deliberation.approachIds.length)} approaches ·{" "}
                  {deliberation.criteria.join(", ")}
                </p>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

export function ProgramEvaluationComparison(props: {
  readonly evaluations: NonNullable<ProgramProjection["evaluations"]>;
}) {
  if (props.evaluations.length === 0) return null;
  return (
    <section
      aria-labelledby="program-evaluations"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 id="program-evaluations" className="text-sm font-semibold">
            Evaluation comparison
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Speed alone does not rank these arms. Compare accepted outcomes, unsafe effects,
            recovery, and operator work together.
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {readableCount(props.evaluations.length)} reports
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table
          aria-label="Program evaluation comparison"
          className="w-full min-w-[72rem] border-separate border-spacing-0 text-left text-xs"
        >
          <thead>
            <tr className="text-muted-foreground">
              {[
                "Arm",
                "Accepted tasks",
                "Elapsed / compute",
                "Tokens / cost",
                "Review / CI",
                "Duplicate / stale",
                "Crash recovery",
                "Operator / defects",
                "Throughput / latency",
              ].map((label) => (
                <th
                  key={label}
                  className="border-b border-border px-3 py-2 font-medium first:pl-0 last:pr-0"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.evaluations.map((evaluation) => {
              const metrics = evaluation.metrics;
              return (
                <tr key={evaluation.evaluationId} className="align-top">
                  <th className="border-b border-border/70 px-3 py-3 pl-0 font-medium last:border-b-0">
                    <span className="block whitespace-nowrap">
                      {PROGRAM_EVALUATION_ARM_LABELS[evaluation.arm]}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] font-normal text-muted-foreground">
                      {evaluation.cohortId}
                    </span>
                  </th>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.acceptedTasks)} / {readableCount(metrics.tasks)}
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableDurationMillis(metrics.elapsedMillis)} /{" "}
                    {readableDurationMillis(metrics.activeComputeMillis)}
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.tokens)} / {readableMilliUsd(metrics.costMilliUsd)}
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.reviewRejections)} review /{" "}
                    {readableCount(metrics.ciFailures)} CI
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.duplicateEffects)} duplicate effect
                    {metrics.duplicateEffects === 1 ? "" : "s"} /{" "}
                    {readableCount(metrics.staleEffects)} stale effect
                    {metrics.staleEffects === 1 ? "" : "s"}
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.successfulRecoveries)} /{" "}
                    {readableCount(metrics.injectedCrashes)} recovered
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 tabular-nums">
                    {readableCount(metrics.operatorInterventions)} operator /{" "}
                    {readableCount(metrics.postAdmissionDefects)} post-Admission defect
                    {metrics.postAdmissionDefects === 1 ? "" : "s"}
                  </td>
                  <td className="border-b border-border/70 px-3 py-3 pr-0 tabular-nums">
                    {readableCount(metrics.integratedPhases)} Phases /{" "}
                    {readableDurationMillis(metrics.readyWorkLatencyMillis)} ready latency
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProgramBudgets(props: {
  readonly budgets: NonNullable<ProgramProjection["budgets"]>;
}) {
  return (
    <section
      aria-labelledby="program-budgets"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="program-budgets" className="text-sm font-semibold">
          Program budgets
        </h2>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            props.budgets.dispatchAllowed
              ? "border-success/32 text-success-foreground"
              : "border-warning/32 bg-warning/8 text-warning-foreground",
          )}
        >
          {props.budgets.dispatchAllowed ? "Dispatch allowed" : "Dispatch stopped"}
        </span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {PROGRAM_BUDGET_LABELS.map(([key, label]) => {
          const budget = props.budgets[key];
          const exhausted = props.budgets.exhausted.includes(key);
          return (
            <div
              key={key}
              aria-label={`${label} ${readableCount(budget.used)} / ${readableCount(budget.limit)}`}
              className="min-w-0"
              role="group"
            >
              <dt className={exhausted ? "text-warning-foreground" : "text-muted-foreground"}>
                {label}
              </dt>
              <dd className="mt-0.5 font-mono tabular-nums">
                {readableCount(budget.used)} / {readableCount(budget.limit)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
