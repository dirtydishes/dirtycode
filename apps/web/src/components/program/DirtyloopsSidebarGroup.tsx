import type { ProgramId, ProgramSummary } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon, GitGraphIcon } from "lucide-react";
import { useMemo } from "react";

import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { programEnvironment } from "../../state/programs";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "~/lib/utils";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { programStatePresentation } from "./programPresentation";

function newestFirst(left: ProgramSummary, right: ProgramSummary): number {
  return right.lastEventAt.localeCompare(left.lastEventAt);
}

const SETTLED_PROGRAM_PREVIEW_LIMIT = 3;

export function DirtyloopsSidebarGroup() {
  const environmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const live = useEnvironmentQuery(
    environmentId === null ? null : programEnvironment.live({ environmentId, input: {} }),
  );
  const programs = useMemo(
    () => (live.data === null ? [] : [...live.data.programs.values()].sort(newestFirst)),
    [live.data],
  );
  const params = useParams({ strict: false }) as { readonly programId?: string };
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();

  if (environmentId === null || programs.length === 0) {
    return null;
  }

  const openProgram = (programId: ProgramId) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({
      to: "/programs/$environmentId/$programId",
      params: { environmentId, programId },
    });
  };
  const environmentLabel =
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    environmentId;

  return (
    <DirtyloopsProgramList
      activeProgramId={params.programId ?? null}
      environmentLabel={environmentLabel}
      onOpen={openProgram}
      programs={programs}
    />
  );
}

export function DirtyloopsProgramList(props: {
  readonly activeProgramId: string | null;
  readonly environmentLabel: string;
  readonly onOpen: (programId: ProgramId) => void;
  readonly programs: ReadonlyArray<ProgramSummary>;
}) {
  const activePrograms = props.programs.filter((program) => !program.terminal);
  const settledPrograms = props.programs.filter((program) => program.terminal);
  const settledPreview = settledPrograms.slice(0, SETTLED_PROGRAM_PREVIEW_LIMIT);
  const settledOverflow = settledPrograms.slice(SETTLED_PROGRAM_PREVIEW_LIMIT);

  const renderProgram = (program: ProgramSummary) => {
    const presentation = programStatePresentation(program.state);
    const active = props.activeProgramId === program.programId;
    return (
      <li key={program.programId} className="list-none py-0.5">
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`${program.title}, ${props.environmentLabel}, ${presentation.label}, ${program.phaseCount} phases, ${program.activeAgentCount} active agents`}
          onClick={() => props.onOpen(program.programId)}
          className={cn(
            "group/program relative flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : "bg-sidebar-row-hover/35 text-sidebar-foreground hover:bg-sidebar-row-hover",
            program.terminal && "opacity-70",
          )}
        >
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", presentation.indicatorClass)}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{program.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sidebar-muted-foreground">
              <span>{presentation.label}</span>
              <span aria-hidden>·</span>
              <span>
                {program.phaseCount} phase{program.phaseCount === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span>
                {program.activeAgentCount} active agent
                {program.activeAgentCount === 1 ? "" : "s"}
              </span>
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <>
      <li
        className="mb-1 mt-0.5 flex list-none items-center gap-2 px-2.5 py-1"
        data-testid="dirtyloops-sidebar-heading"
      >
        <GitGraphIcon aria-hidden className="size-3.5 text-sidebar-muted-foreground/70" />
        <span className="text-[11px] font-semibold tracking-wide text-sidebar-muted-foreground/70 lowercase">
          dirtyloops
        </span>
        <span aria-hidden className="text-sidebar-muted-foreground/40">
          ·
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 truncate text-[10px] text-sidebar-muted-foreground/60">
                {props.environmentLabel}
              </span>
            }
          />
          <TooltipPopup side="bottom">{props.environmentLabel}</TooltipPopup>
        </Tooltip>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-sidebar-muted-foreground/50">
          {props.programs.length}
        </span>
      </li>
      {activePrograms.map(renderProgram)}
      {settledPrograms.length > 0 ? (
        <li className="list-none px-2.5 pb-0.5 pt-2 text-[10px] font-medium tracking-wide text-sidebar-muted-foreground/60 uppercase">
          Settled Programs
        </li>
      ) : null}
      {settledPreview.map(renderProgram)}
      {settledOverflow.length > 0 ? (
        <li className="list-none">
          <details className="group/settled-programs">
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2.5 text-[11px] text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronDownIcon
                aria-hidden
                className="size-3.5 transition-transform group-open/settled-programs:rotate-180"
              />
              Show {settledOverflow.length} more settled Program
              {settledOverflow.length === 1 ? "" : "s"}
            </summary>
            <ul className="m-0 list-none p-0">{settledOverflow.map(renderProgram)}</ul>
          </details>
        </li>
      ) : null}
      <li aria-hidden className="mx-2.5 my-1.5 h-px list-none bg-sidebar-border/60" />
    </>
  );
}
