import type { EnvironmentId, ProgramAttemptSnapshot } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    readonly children: ReactNode;
    readonly params: { readonly environmentId: string; readonly threadId: string };
  }) => (
    <a href={`/${props.params.environmentId}/${props.params.threadId}`} data-router-link>
      {props.children}
    </a>
  ),
}));

import {
  ProgramAttemptLoadError,
  ProgramAttemptSummary,
  programAttemptAttention,
} from "./ThreadProgramAttemptPanel";

function snapshot(overrides: Partial<ProgramAttemptSnapshot> = {}): ProgramAttemptSnapshot {
  return {
    attemptId: "attempt:s6",
    programId: "agents-dlr",
    taskId: "agents-dlr.7",
    attemptKind: "task",
    candidateId: null,
    reviewId: null,
    reviewKind: null,
    title: "S6 certification",
    checkout: {
      repositoryRoot: "/repo",
      gitCommonDir: "/repo/.git",
      worktreePath: "/repo/worktrees/prepared",
      branch: "lavender/dirtyloops-parallel-runner",
      startingCommit: "1234567890abcdef",
    },
    projectId: "project:s6",
    threadId: "thread:s6",
    runId: "run:s6",
    state: "active",
    runStatus: "running",
    terminalResult: null,
    terminalAcknowledged: false,
    ...overrides,
  } as ProgramAttemptSnapshot;
}

describe("ThreadProgramAttemptPanel", () => {
  it("renders exact Task identity and read-only CLI guidance", () => {
    const markup = renderToStaticMarkup(
      <ProgramAttemptSummary
        attempt={snapshot()}
        environmentId={"environment:s6" as EnvironmentId}
        status="running"
      />,
    );
    expect(markup).toContain("S6 certification");
    expect(markup).toContain("agents-dlr.7");
    expect(markup).toContain("/repo/worktrees/prepared");
    expect(markup).toContain("dirtyloops inspect");
    expect(markup).toContain("dirtyloops stop agents-dlr.7");
    expect(markup).toContain('href="/environment:s6/thread:s6"');
    expect(markup).toContain("data-router-link");
    expect(markup).not.toContain("Retry");
    expect(markup).not.toContain("Admission");
  });

  it("identifies a focused candidate review and its live state", () => {
    const markup = renderToStaticMarkup(
      <ProgramAttemptSummary
        attempt={snapshot({
          attemptKind: "review",
          reviewKind: "focused",
          reviewId: "review:s6",
          candidateId: "candidate:0123456789",
          title: "agents-dlr.7 · focused candidate review",
        })}
        environmentId={"environment:s6" as EnvironmentId}
        status="completed"
      />,
    );
    expect(markup).toContain("dirtyloops review");
    expect(markup).toContain("focused candidate review");
    expect(markup).toContain("Focused review · Completed");
    expect(markup).toContain("candidate:0123456789");
  });

  it("does not invent a retry decision", () => {
    expect(programAttemptAttention(snapshot(), "running")).toBe("None");
    expect(programAttemptAttention(snapshot(), "interrupted")).toContain("dirtyloops will decide");
  });

  it("renders a failed attempt lookup instead of hiding the dirtyloops section", () => {
    const markup = renderToStaticMarkup(<ProgramAttemptLoadError error="connection lost" />);

    expect(markup).toContain("Unable to load dirtyloops attempt details: connection lost");
    expect(markup).toContain('role="alert"');
  });
});
