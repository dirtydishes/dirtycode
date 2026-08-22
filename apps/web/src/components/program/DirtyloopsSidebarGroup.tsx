import type { ProgramId, ProgramSummary } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { GitGraphIcon } from "lucide-react";
import { useMemo } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { programEnvironment } from "../../state/programs";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "~/lib/utils";
import { useSidebar } from "../ui/sidebar";
import { programStatePresentation } from "./programPresentation";

function newestFirst(left: ProgramSummary, right: ProgramSummary): number {
  return right.lastEventAt.localeCompare(left.lastEventAt);
}

export function DirtyloopsSidebarGroup() {
  const environmentId = usePrimaryEnvironmentId();
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
  const activePrograms = programs.filter((program) => !program.terminal);
  const settledPrograms = programs.filter((program) => program.terminal);

  const renderProgram = (program: ProgramSummary) => {
    const presentation = programStatePresentation(program.state);
    const active = params.programId === program.programId;
    return (
      <li key={program.programId} className="list-none py-0.5">
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          aria-label={`${program.title}, ${presentation.label}, ${program.phaseCount} phases, ${program.activeAgentCount} active agents`}
          onClick={() => openProgram(program.programId)}
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
        <span className="ml-auto font-mono text-[10px] tabular-nums text-sidebar-muted-foreground/50">
          {programs.length}
        </span>
      </li>
      {activePrograms.map(renderProgram)}
      {settledPrograms.length > 0 ? (
        <li className="list-none px-2.5 pb-0.5 pt-2 text-[10px] font-medium tracking-wide text-sidebar-muted-foreground/60 uppercase">
          Settled Programs
        </li>
      ) : null}
      {settledPrograms.map(renderProgram)}
      <li aria-hidden className="mx-2.5 my-1.5 h-px list-none bg-sidebar-border/60" />
    </>
  );
}
