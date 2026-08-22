import type { ProgramState } from "@t3tools/contracts";

export interface ProgramStatePresentation {
  readonly label: string;
  readonly indicatorClass: string;
  readonly badgeClass: string;
}

const PRESENTATION: Record<ProgramState, ProgramStatePresentation> = {
  draft: {
    label: "Draft",
    indicatorClass: "bg-sky-500 animate-pulse motion-reduce:animate-none",
    badgeClass: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300",
  },
  ready: {
    label: "Ready",
    indicatorClass: "bg-sky-500",
    badgeClass: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300",
  },
  running: {
    label: "Running",
    indicatorClass: "bg-emerald-500 animate-pulse motion-reduce:animate-none",
    badgeClass: "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  },
  pausing: {
    label: "Pausing",
    indicatorClass: "bg-amber-500 animate-pulse motion-reduce:animate-none",
    badgeClass: "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  },
  paused: {
    label: "Paused",
    indicatorClass: "bg-amber-500",
    badgeClass: "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  },
  attention_required: {
    label: "Needs attention",
    indicatorClass: "bg-rose-500",
    badgeClass: "border-rose-500/20 bg-rose-500/8 text-rose-700 dark:text-rose-300",
  },
  stopping: {
    label: "Stopping",
    indicatorClass: "bg-muted-foreground animate-pulse motion-reduce:animate-none",
    badgeClass: "border-border bg-muted/40 text-muted-foreground",
  },
  stopped: {
    label: "Stopped",
    indicatorClass: "bg-muted-foreground",
    badgeClass: "border-border bg-muted/40 text-muted-foreground",
  },
  certifying: {
    label: "Certifying",
    indicatorClass: "bg-violet-500 animate-pulse motion-reduce:animate-none",
    badgeClass: "border-violet-500/20 bg-violet-500/8 text-violet-700 dark:text-violet-300",
  },
  completed: {
    label: "Completed",
    indicatorClass: "bg-violet-500",
    badgeClass: "border-violet-500/20 bg-violet-500/8 text-violet-700 dark:text-violet-300",
  },
};

export function programStatePresentation(state: ProgramState): ProgramStatePresentation {
  return PRESENTATION[state];
}
