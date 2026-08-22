import type {
  ProgramCommand,
  ProgramCommandDecision,
  ProgramProjection,
  ProgramStatusRailItem,
} from "@t3tools/contracts";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CopyIcon,
  GitGraphIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { Button } from "../ui/button";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { programStatePresentation } from "./programPresentation";
import type { ProgramTransportState } from "./programRouteState";

const STAGE_LABELS: Record<ProgramStatusRailItem["stage"], string> = {
  plan: "Plan",
  ready: "Ready",
  execute: "Execute",
  review: "Review",
  ci: "CI",
  admit: "Admit",
  advance: "Advance",
};

function statusRailIcon(state: ProgramStatusRailItem["state"]) {
  if (state === "settled") return CheckIcon;
  if (state === "failed") return CircleAlertIcon;
  return CircleDashedIcon;
}

function readableTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

function readableCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

type ProgramPhase = ProgramProjection["phases"][number];

function leaseHealth(phase: ProgramPhase, now: number) {
  if (phase.preparedWorktree === null || phase.leaseHeartbeatAt === null) {
    return {
      label: "Awaiting heartbeat",
      className: "border-border text-muted-foreground",
      attention: true,
    };
  }
  const remaining = Date.parse(phase.preparedWorktree.expiresAt) - now;
  if (remaining <= 0) {
    return {
      label: "Expired",
      className: "border-error/32 bg-error-surface text-error-foreground",
      attention: true,
    };
  }
  if (remaining <= 5 * 60_000) {
    return {
      label: "Near expiry",
      className: "border-warning/32 bg-warning/8 text-warning-foreground",
      attention: true,
    };
  }
  return {
    label: "Valid",
    className: "border-success/32 bg-success/8 text-success-foreground",
    attention: false,
  };
}

function PreparedWorktreeDiagnostics({ phase }: { readonly phase: ProgramPhase }) {
  const worktree = phase.preparedWorktree;
  const [now, setNow] = useState(() => Date.now());
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "starting commit",
    timeout: 1_200,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (worktree === null) return null;
  const health = leaseHealth(phase, now);
  const defaultOpen = health.attention || phase.state === "running";
  const shortCommit = worktree.startingCommit.slice(0, 12);

  return (
    <Collapsible defaultOpen={defaultOpen} className="mt-3 border-t border-border pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span
          aria-label={`Lease status: ${health.label}`}
          className={cn("rounded-full border px-2 py-0.5 font-medium", health.className)}
          role="status"
        >
          {health.label}
        </span>
        <span className="text-muted-foreground">Lease epoch {worktree.leaseEpoch}</span>
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <span className="text-muted-foreground">
          expires <time dateTime={worktree.expiresAt}>{readableTime(worktree.expiresAt)}</time>
        </span>
      </div>
      <CollapsibleTrigger className="group mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 transition-transform group-data-panel-open:rotate-180"
        />
        Worktree details
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <dl
          aria-label={`Prepared worktree for ${phase.title}`}
          className="grid min-w-0 gap-x-4 gap-y-2 pt-3 text-xs sm:grid-cols-2"
        >
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-muted-foreground">Prepared worktree</dt>
            <dd className="mt-0.5 min-w-0 font-mono text-[11px]">
              <StartTruncatedPath path={worktree.realPath} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="mt-0.5 truncate font-mono text-[11px]" title={worktree.symbolicBranch}>
              {worktree.symbolicBranch}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Starting commit</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px]">
              <Tooltip>
                <TooltipTrigger render={<span className="truncate" />}>
                  {shortCommit}
                </TooltipTrigger>
                <TooltipPopup className="max-w-sm break-all font-mono" side="top">
                  {worktree.startingCommit}
                </TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={isCopied ? "Copied starting commit" : "Copy starting commit"}
                      onClick={() => copyToClipboard(worktree.startingCommit)}
                      size="icon-micro"
                      variant="ghost-muted"
                    />
                  }
                >
                  <CopyIcon aria-hidden className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {isCopied ? "Copied" : "Copy full starting commit"}
                </TooltipPopup>
              </Tooltip>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last verified</dt>
            <dd className="mt-0.5">
              {phase.leaseHeartbeatAt ? (
                <time dateTime={phase.leaseHeartbeatAt}>
                  {readableTime(phase.leaseHeartbeatAt)}
                </time>
              ) : (
                "Awaiting first heartbeat"
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Declared paths</dt>
            <dd className="mt-0.5 break-words">
              {worktree.declaredPaths.length > 0
                ? worktree.declaredPaths.join(", ")
                : "Phase acceptance boundary"}
            </dd>
          </div>
        </dl>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export interface ProgramWorkspaceProps {
  readonly projection: ProgramProjection;
  readonly commandPending: ProgramCommand | null;
  readonly commandFeedback:
    | ProgramCommandDecision
    | { readonly status: "failed"; readonly code: "transport_error"; readonly message: string }
    | null;
  readonly transportState: ProgramTransportState;
  readonly onCommand: (command: Extract<ProgramCommand, "pause" | "resume" | "stop">) => void;
}

export function ProgramWorkspace(props: ProgramWorkspaceProps) {
  const { projection } = props;
  const presentation = programStatePresentation(projection.state);
  const lastActivity = projection.activity.at(-1) ?? null;
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    if (!projection.allowedCommands.includes("stop")) setConfirmStop(false);
  }, [projection.allowedCommands]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-b border-border px-3 sm:px-5",
          isElectron && "drag-region",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        <GitGraphIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{projection.title}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
            presentation.badgeClass,
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", presentation.indicatorClass)} />
          {presentation.label}
        </span>
      </header>

      {props.transportState !== null ? (
        <div
          className="border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          {props.transportState === "stale"
            ? `Live updates are disconnected. Showing the last known state from ${readableTime(projection.lastEventAt)}.`
            : `Synchronizing live updates. Showing the last known state from ${readableTime(projection.lastEventAt)}.`}
        </div>
      ) : null}

      {projection.sourceIdentity?.parity === "stale" ? (
        <div
          className="border-error/32 bg-error-surface text-error-foreground border-b px-4 py-2 text-xs"
          role="alert"
        >
          The installed dirtyloops skill no longer matches its certified source. Mutable work is
          blocked until parity is restored.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-7xl gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)]">
          <div className="min-w-0 space-y-4">
            <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Program outcome
                  </p>
                  <h1 className="mt-2 text-balance text-xl font-semibold text-foreground sm:text-2xl">
                    {projection.outcome}
                  </h1>
                  <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground/70">
                    {projection.programId}
                  </p>
                </div>
                <div
                  aria-busy={props.commandPending !== null}
                  className="flex shrink-0 flex-wrap gap-2"
                >
                  {projection.allowedCommands.includes("pause") ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.commandPending !== null}
                      onClick={() => props.onCommand("pause")}
                    >
                      <PauseIcon aria-hidden />
                      Pause
                    </Button>
                  ) : null}
                  {projection.allowedCommands.includes("resume") ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.commandPending !== null}
                      onClick={() => props.onCommand("resume")}
                    >
                      <PlayIcon aria-hidden />
                      Resume
                    </Button>
                  ) : null}
                  {projection.allowedCommands.includes("stop") ? (
                    <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={props.commandPending !== null}
                          />
                        }
                      >
                        <SquareIcon aria-hidden />
                        Stop
                      </AlertDialogTrigger>
                      <AlertDialogPopup>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Stop {projection.title}?</AlertDialogTitle>
                          <AlertDialogDescription className="break-all">
                            This stops Program {projection.programId}. Its settled record will
                            remain in the dirtyloops sidebar.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogClose render={<Button variant="outline" />}>
                            Cancel
                          </AlertDialogClose>
                          <Button
                            variant="destructive"
                            disabled={props.commandPending !== null}
                            onClick={() => {
                              setConfirmStop(false);
                              props.onCommand("stop");
                            }}
                          >
                            Stop Program
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogPopup>
                    </AlertDialog>
                  ) : null}
                </div>
              </div>
              {projection.attentionReason ? (
                <p className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/6 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                  {projection.attentionReason}
                </p>
              ) : null}
              {props.commandPending !== null ? (
                <p aria-live="polite" className="mt-3 text-xs text-muted-foreground" role="status">
                  {props.commandPending} command in progress…
                </p>
              ) : null}
              {props.commandFeedback ? (
                <p
                  aria-live="polite"
                  className={cn(
                    "mt-3 text-xs",
                    props.commandFeedback.status === "accepted"
                      ? "text-muted-foreground"
                      : "text-rose-700 dark:text-rose-300",
                  )}
                  role={props.commandFeedback.status === "accepted" ? "status" : "alert"}
                >
                  <span className="font-mono">{props.commandFeedback.code}</span>
                  {": "}
                  {props.commandFeedback.message}
                </p>
              ) : null}
            </section>

            <section
              aria-labelledby="program-status-rail"
              className="rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="program-status-rail" className="text-sm font-semibold">
                  Status rail
                </h2>
                <span className="font-mono text-[11px] text-muted-foreground">
                  revision {projection.revision}
                </span>
              </div>
              <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {projection.statusRail.map((item) => {
                  const Icon = statusRailIcon(item.state);
                  return (
                    <li
                      key={item.stage}
                      className={cn(
                        "rounded-lg border px-3 py-3",
                        item.state === "active"
                          ? "border-primary/30 bg-primary/6"
                          : item.state === "failed"
                            ? "border-rose-500/25 bg-rose-500/6"
                            : "border-border bg-muted/20",
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          "size-4",
                          item.state === "active" &&
                            "animate-pulse text-primary motion-reduce:animate-none",
                          item.state === "settled" && "text-emerald-600 dark:text-emerald-400",
                          item.state === "pending" && "text-muted-foreground/55",
                          item.state === "failed" && "text-rose-600 dark:text-rose-400",
                        )}
                      />
                      <p className="mt-2 text-xs font-medium">{STAGE_LABELS[item.stage]}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground capitalize">
                        {item.state}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section
              aria-labelledby="program-phases"
              className="rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="program-phases" className="text-sm font-semibold">
                  Program graph
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {projection.phases.length} total
                </span>
              </div>
              <ol className="mt-3 divide-y divide-border">
                {projection.phases.map((phase, index) => (
                  <li
                    key={phase.phaseId}
                    className="flex items-start gap-3 py-3 first:pt-1 last:pb-0"
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 font-mono text-[10px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{phase.title}</p>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                          {phase.state.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/65">
                        {phase.phaseId}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {phase.phaseCoordinatorThreadId
                          ? `Phase coordinator ${phase.phaseCoordinatorThreadId}`
                          : `Phase coordinator target ${phase.phaseCoordinatorTargetThreadId}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {phase.ownerThreadId
                          ? `Owner thread ${phase.ownerThreadId}`
                          : "No owner thread is bound."}
                      </p>
                      <PreparedWorktreeDiagnostics phase={phase} />
                      {phase.dependencyIds.length > 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Depends on {phase.dependencyIds.join(", ")}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">No dependencies.</p>
                      )}
                      <div
                        aria-atomic="true"
                        aria-label={`Blocker status for ${phase.title}`}
                        aria-live="polite"
                        role="status"
                      >
                        {phase.blockedBy.length > 0 ? (
                          <p className="text-warning-foreground mt-1 text-xs">
                            Blocked by {phase.blockedBy.join(", ")}
                          </p>
                        ) : (
                          <p className="sr-only">No blockers.</p>
                        )}
                        {phase.blockedBy.length > 0 && phase.blockerPath.length > 0 ? (
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            Blocker path: {phase.blockerPath.join(" to ")}
                          </p>
                        ) : null}
                      </div>
                      {phase.budgets ? (
                        <dl className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                          <div className="rounded-full border border-border px-2 py-1">
                            <dt className="sr-only">Attempt budget</dt>
                            <dd>
                              Attempts {readableCount(phase.budgets.attempts.used)} /{" "}
                              {readableCount(phase.budgets.attempts.limit)}
                            </dd>
                          </div>
                          <div className="rounded-full border border-border px-2 py-1">
                            <dt className="sr-only">Time budget</dt>
                            <dd>
                              Time {readableCount(phase.budgets.wallClockMinutes.used)} /{" "}
                              {readableCount(phase.budgets.wallClockMinutes.limit)} min
                            </dd>
                          </div>
                          <div className="rounded-full border border-border px-2 py-1">
                            <dt className="sr-only">Token budget</dt>
                            <dd>
                              Tokens {readableCount(phase.budgets.tokens.used)} /{" "}
                              {readableCount(phase.budgets.tokens.limit)}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section
              aria-labelledby="program-attempts"
              className="rounded-xl border border-border bg-card p-4 sm:p-5"
            >
              <h2 id="program-attempts" className="text-sm font-semibold">
                Owner attempts
              </h2>
              {projection.attempts.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">No owner attempt is retained.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {projection.attempts.map((attempt) => (
                    <li key={attempt.attemptId} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-medium capitalize">{attempt.ownerKind} owner</span>
                        <span className="capitalize text-muted-foreground">
                          {attempt.state.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/65">
                        {attempt.attemptId}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {attempt.threadId
                          ? `Owner thread ${attempt.threadId}`
                          : "Owner thread not launched."}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <BotIcon aria-hidden className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Runtime boundary</h2>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Active agents</dt>
                  <dd className="mt-1 font-mono text-sm">{projection.activeAgentCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Receipts</dt>
                  <dd className="mt-1 font-mono text-sm">{projection.receipts.length}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Last event</dt>
                  <dd className="mt-1">{readableTime(projection.lastEventAt)}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-medium">Codex Goal</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {projection.goalCapability.available
                    ? `${projection.goalCapability.adapter} adapter available.`
                    : (projection.goalCapability.reason ?? "Goal adapter unavailable.")}
                </p>
              </div>
              {projection.sourceIdentity && projection.repositorySnapshot ? (
                <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium">Source parity</p>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        projection.sourceIdentity.parity === "current"
                          ? "border-success/32 text-success-foreground"
                          : "border-error/32 text-error-foreground",
                      )}
                    >
                      {projection.sourceIdentity.parity === "current" ? "Current" : "Stale"}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Repository</dt>
                      <dd className="mt-0.5 break-all font-mono">
                        {projection.repositorySnapshot.repositoryId}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Integration ref</dt>
                      <dd className="mt-0.5 break-all font-mono">
                        {projection.repositorySnapshot.integrationRef}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Symbolic ref</dt>
                      <dd className="mt-0.5 break-all font-mono">
                        {projection.repositorySnapshot.symbolicRef}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Observed HEAD</dt>
                      <dd className="mt-0.5 break-all font-mono">
                        {projection.repositorySnapshot.head}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Source commit</dt>
                      <dd className="mt-0.5 break-all font-mono">
                        {projection.sourceIdentity.sourceCommit}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </section>

            <section
              aria-labelledby="program-receipts"
              className="rounded-xl border border-border bg-card p-4"
            >
              <h2 id="program-receipts" className="text-sm font-semibold">
                Typed receipts
              </h2>
              {projection.receipts.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  No T3 effect has returned a receipt yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {projection.receipts.map((receipt) => (
                    <li
                      key={receipt.receiptId}
                      className="rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">
                          {receipt.kind.replaceAll("_", " ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {receipt.acknowledged ? "Acknowledged" : "Retained"}
                        </span>
                      </div>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/65">
                        {receipt.receiptId}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="program-activity"
              className="rounded-xl border border-border bg-card p-4"
            >
              <h2 id="program-activity" className="text-sm font-semibold">
                Activity
              </h2>
              {lastActivity === null ? (
                <p className="mt-3 text-xs text-muted-foreground">No activity recorded.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {projection.activity
                    .toReversed()
                    .slice(0, 8)
                    .map((activity) => (
                      <li key={activity.eventId} className="border-l border-border pl-3">
                        <p className="text-xs leading-5">{activity.message}</p>
                        <time
                          dateTime={activity.occurredAt}
                          className="mt-0.5 block text-[10px] text-muted-foreground"
                        >
                          {readableTime(activity.occurredAt)}
                        </time>
                      </li>
                    ))}
                </ol>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
