import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  ProgramId,
  type ProgramCommand,
  type ProgramCommandDecision,
  type ProgramProjection,
  ProgramRequestId,
} from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ProgramWorkspace } from "../components/program/ProgramWorkspace";
import { SidebarInset } from "../components/ui/sidebar";
import { programEnvironment } from "../state/programs";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";

type WorkspaceCommand = Extract<ProgramCommand, "pause" | "resume" | "stop">;
let programCommandSequence = 0;

function ProgramRouteView() {
  const params = Route.useParams();
  const environmentId = EnvironmentId.make(params.environmentId);
  const programId = ProgramId.make(params.programId);
  const detail = useEnvironmentQuery(
    programEnvironment.detail({ environmentId, input: { programId } }),
  );
  const live = useEnvironmentQuery(programEnvironment.live({ environmentId, input: {} }));
  const mutate = useAtomCommand(programEnvironment.mutate, { reportFailure: false });
  const [commandPending, setCommandPending] = useState<WorkspaceCommand | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<
    | ProgramCommandDecision
    | { readonly status: "failed"; readonly code: "transport_error"; readonly message: string }
    | null
  >(null);
  const [commandProjection, setCommandProjection] = useState<ProgramProjection | null>(null);
  const liveSummary = live.data?.programs.get(programId) ?? null;

  useEffect(() => {
    if (liveSummary !== null) detail.refresh();
  }, [liveSummary?.lastEventAt]);

  useEffect(() => {
    if (
      commandProjection !== null &&
      detail.data !== null &&
      detail.data.projection.revision >= commandProjection.revision
    ) {
      setCommandProjection(null);
    }
  }, [commandProjection, detail.data]);

  const projection = commandProjection ?? detail.data?.projection ?? null;
  const handleCommand = async (command: WorkspaceCommand) => {
    setCommandPending(command);
    setCommandFeedback(null);
    const requestId = ProgramRequestId.make(
      `request:web:${programId}:${command}:${Date.now()}:${++programCommandSequence}`,
    );
    const input =
      command === "stop"
        ? { programId, requestId, reason: "Stopped from the Program workspace." }
        : { programId, requestId };
    const result = await mutate({ environmentId, input: { kind: command, input } });
    setCommandPending(null);
    if (result._tag === "Success") {
      setCommandProjection(result.value.projection);
      setCommandFeedback(result.value.decision);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setCommandFeedback({
        status: "failed",
        code: "transport_error",
        message: error instanceof Error ? error.message : "The Program command failed.",
      });
    }
  };

  const status = useMemo(() => {
    if (projection !== null) return null;
    if (detail.error !== null) return detail.error;
    return detail.isPending ? "Loading Program…" : "Program not found.";
  }, [detail.error, detail.isPending, projection]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      {projection === null ? (
        <div
          className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground"
          role="status"
        >
          {status}
        </div>
      ) : (
        <ProgramWorkspace
          projection={projection}
          commandPending={commandPending}
          commandFeedback={commandFeedback}
          onCommand={(command) => void handleCommand(command)}
        />
      )}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/programs/$environmentId/$programId")({
  component: ProgramRouteView,
});
