import type { ProgramDeliberationEventPayload, ProgramProjection } from "@t3tools/contracts";

const DELIBERATION_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  gathering: new Set(["gathering", "proposing", "challenging", "stopped"]),
  proposing: new Set(["proposing", "challenging", "judging", "synthesizing", "decided", "stopped"]),
  challenging: new Set(["challenging", "rebutting", "judging", "stopped"]),
  rebutting: new Set(["challenging", "rebutting", "judging", "synthesizing", "stopped"]),
  judging: new Set(["judging", "synthesizing", "decided", "stopped"]),
  synthesizing: new Set(["synthesizing", "decided", "stopped"]),
  decided: new Set(),
  stopped: new Set(),
};

export function deliberationPayloadIsValid(
  projection: ProgramProjection,
  payload: ProgramDeliberationEventPayload,
): boolean {
  if (
    payload.phaseId !== null &&
    !projection.phases.some((phase) => phase.phaseId === payload.phaseId)
  ) {
    return false;
  }
  const allowedThreads = new Set<string>(
    projection.threadBindings.map((binding) => binding.threadId),
  );
  if (
    payload.participantThreadIds.length === 0 ||
    payload.participantThreadIds.some((threadId) => !allowedThreads.has(threadId)) ||
    (payload.authorThreadId !== null &&
      (!allowedThreads.has(payload.authorThreadId) ||
        !payload.participantThreadIds.includes(payload.authorThreadId))) ||
    payload.evidence.some(
      (evidence) => evidence.kind === "thread" && !allowedThreads.has(evidence.id),
    )
  ) {
    return false;
  }
  const retained = (projection.deliberations ?? []).find(
    (deliberation) => deliberation.deliberationId === payload.deliberationId,
  );
  if (retained === undefined) {
    return (
      payload.kind === "approach_proposed" &&
      payload.state === "proposing" &&
      payload.approachId !== null &&
      payload.authorThreadId !== null
    );
  }
  return (
    retained.phaseId === payload.phaseId &&
    retained.question === payload.question &&
    JSON.stringify(retained.criteria) === JSON.stringify(payload.criteria) &&
    (DELIBERATION_TRANSITIONS[retained.state]?.has(payload.state) ?? false) &&
    (payload.kind !== "approach_proposed" || payload.approachId !== null) &&
    (payload.kind !== "synthesis_recorded" ||
      payload.state === "synthesizing" ||
      payload.state === "decided") &&
    (payload.kind !== "deliberation_stopped" || payload.state === "stopped")
  );
}
