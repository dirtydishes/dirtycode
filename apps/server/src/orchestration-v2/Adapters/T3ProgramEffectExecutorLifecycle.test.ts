import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  bindEffect,
  cancelEffect,
  launchEffect,
  makeOwnerLifecycleHarness,
} from "./T3ProgramEffectExecutorLifecycle.testkit.ts";

it.effect("binds one dirtyloops-prepared worktree exactly once", () =>
  Effect.gen(function* () {
    const harness = makeOwnerLifecycleHarness();

    expect(Option.isNone(yield* harness.adapter.observe(bindEffect, harness.context))).toBe(true);
    yield* harness.adapter.execute(bindEffect, harness.context);

    expect(Option.isSome(yield* harness.adapter.observe(bindEffect, harness.context))).toBe(true);
    expect(harness.counts).toMatchObject({ verify: 1, bind: 1 });
  }),
);

it.effect("recovers an owner launch without starting a duplicate Attempt", () =>
  Effect.gen(function* () {
    const harness = makeOwnerLifecycleHarness();
    yield* harness.adapter.execute(bindEffect, harness.context);

    expect(Option.isNone(yield* harness.adapter.observe(launchEffect, harness.context))).toBe(true);
    yield* harness.adapter.execute(launchEffect, harness.context);
    const restarted = harness.restarted();

    expect(Option.isSome(yield* restarted.observe(launchEffect, harness.context))).toBe(true);
    expect(harness.counts.launch).toBe(1);
  }),
);

it.effect("cancels a launched owner once and observes the retained terminal result", () =>
  Effect.gen(function* () {
    const harness = makeOwnerLifecycleHarness();
    yield* harness.adapter.execute(bindEffect, harness.context);
    yield* harness.adapter.execute(launchEffect, harness.context);

    yield* harness.adapter.execute(cancelEffect, harness.context);

    expect(Option.isSome(yield* harness.restarted().observe(cancelEffect, harness.context))).toBe(
      true,
    );
    expect(harness.counts.cancel).toBe(1);
  }),
);

it.effect("acknowledges only the exact terminal owner result identity", () =>
  Effect.gen(function* () {
    const harness = makeOwnerLifecycleHarness();
    yield* harness.adapter.execute(bindEffect, harness.context);
    yield* harness.adapter.execute(launchEffect, harness.context);
    yield* harness.adapter.execute(cancelEffect, harness.context);
    const acknowledgement = harness.acknowledgeEffect();

    yield* harness.adapter.execute(acknowledgement, harness.context);
    const restarted = harness.restarted();

    expect(Option.isSome(yield* restarted.observe(acknowledgement, harness.context))).toBe(true);
    expect(harness.counts.acknowledge).toBe(1);
    const foreignFailure = yield* restarted
      .observe(harness.foreignAcknowledgement(acknowledgement), harness.context)
      .pipe(Effect.flip);
    expect(String(foreignFailure.cause)).toContain("ProgramAttempt identity does not match");
  }),
);
