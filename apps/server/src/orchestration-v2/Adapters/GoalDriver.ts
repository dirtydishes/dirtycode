import {
  type GoalCapability,
  GoalRef,
  type GoalSnapshot,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class GoalDriverUnavailableError extends Schema.TaggedErrorClass<GoalDriverUnavailableError>()(
  "GoalDriverUnavailableError",
  {
    operation: Schema.Literals(["read", "set", "clear"]),
    ref: GoalRef,
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Goal ${this.operation} is unavailable: ${this.reason}`;
  }
}

export interface GoalDriverShape {
  readonly capabilities: () => Effect.Effect<GoalCapability>;
  readonly read: (ref: GoalRef) => Effect.Effect<GoalSnapshot, GoalDriverUnavailableError>;
  readonly set: (input: {
    readonly ref: GoalRef;
    readonly objective: string;
  }) => Effect.Effect<GoalSnapshot, GoalDriverUnavailableError>;
  readonly clear: (ref: GoalRef) => Effect.Effect<GoalSnapshot | null, GoalDriverUnavailableError>;
}

export class GoalDriver extends Context.Service<GoalDriver, GoalDriverShape>()(
  "t3/orchestration-v2/Adapters/GoalDriver",
) {}

export function makeUnsupportedGoalDriver(reason: string): GoalDriverShape {
  const unavailable = (operation: GoalDriverUnavailableError["operation"], ref: GoalRef) =>
    new GoalDriverUnavailableError({ operation, ref, reason });

  return {
    capabilities: () =>
      Effect.succeed({
        available: false,
        adapter: "unsupported",
        reason,
      }),
    read: (ref) => Effect.fail(unavailable("read", ref)),
    set: ({ ref }) => Effect.fail(unavailable("set", ref)),
    clear: (ref) => Effect.fail(unavailable("clear", ref)),
  };
}

export const unsupportedLayer = (reason: string) =>
  Layer.succeed(GoalDriver, makeUnsupportedGoalDriver(reason));
