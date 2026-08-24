import {
  programStatePresentation as sharedProgramStatePresentation,
  type ProgramStatusTone,
} from "@t3tools/client-runtime/state/program-presentation";
import type { ProgramState } from "@t3tools/contracts";

export interface ProgramStatePresentation {
  readonly label: string;
  readonly indicatorClass: string;
  readonly badgeClass: string;
}

const TONE_CLASSES: Readonly<
  Record<ProgramStatusTone, { readonly indicatorClass: string; readonly badgeClass: string }>
> = {
  info: {
    indicatorClass: "bg-primary",
    badgeClass: "border-primary/30 bg-primary/8 text-primary",
  },
  success: {
    indicatorClass: "bg-success",
    badgeClass: "border-success/32 bg-success/8 text-success-foreground",
  },
  warning: {
    indicatorClass: "bg-warning",
    badgeClass: "border-warning/32 bg-warning/8 text-warning-foreground",
  },
  danger: {
    indicatorClass: "bg-error",
    badgeClass: "border-error/32 bg-error-surface text-error-foreground",
  },
  neutral: {
    indicatorClass: "bg-muted-foreground",
    badgeClass: "border-border bg-muted/40 text-muted-foreground",
  },
};

export function programStatePresentation(state: ProgramState): ProgramStatePresentation {
  const presentation = sharedProgramStatePresentation(state);
  const tone = TONE_CLASSES[presentation.tone];
  return {
    label: presentation.label,
    indicatorClass: `${tone.indicatorClass}${presentation.busy ? " animate-pulse motion-reduce:animate-none" : ""}`,
    badgeClass: tone.badgeClass,
  };
}
