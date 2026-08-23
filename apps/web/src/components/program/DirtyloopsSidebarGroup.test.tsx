import { describe, expect, it } from "@effect/vitest";
import { ProgramId, type ProgramSummary } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { DirtyloopsProgramList } from "./DirtyloopsSidebarGroup";

const program = {
  programId: ProgramId.make("program:environment-identity"),
  title: "Environment identity Program",
  state: "running",
  terminal: false,
  phaseCount: 3,
  activeAgentCount: 2,
  lastEventAt: "2026-08-23T05:00:00.000Z",
} satisfies ProgramSummary;

describe("DirtyloopsProgramList", () => {
  it("renders the connected environment for the dirtyloops Program group", () => {
    const markup = renderToStaticMarkup(
      <DirtyloopsProgramList
        activeProgramId={null}
        environmentLabel="Delta server"
        onOpen={() => undefined}
        programs={[program]}
      />,
    );

    expect(markup).toContain("dirtyloops");
    expect(markup).toContain("Delta server");
    expect(markup).toContain(
      'aria-label="Environment identity Program, Delta server, Running, 3 phases, 2 active agents"',
    );
  });

  it("collapses settled Programs beyond the sidebar preview", () => {
    const settled = Array.from({ length: 6 }, (_, index) => ({
      ...program,
      programId: ProgramId.make(`program:settled:${index}`),
      title: `Settled Program ${index}`,
      state: "completed" as const,
      terminal: true,
      lastEventAt: `2026-08-23T0${index}:00:00.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <DirtyloopsProgramList
        activeProgramId={null}
        environmentLabel="Delta server"
        onOpen={() => undefined}
        programs={settled.toReversed()}
      />,
    );

    expect(markup).toContain("Show 3 more settled Programs");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
  });
});
