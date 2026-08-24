import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type ProgramProjection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import {
  makeDirtyloopsProcessInvoker,
  makeDirtyloopsProgramDriver,
  resolveDirtyloopsDriverClosure,
} from "./DirtyloopsProgramDriver.ts";

import {
  encodeDirtyloopsDecisionJson,
  input,
  options,
  raw,
} from "./DirtyloopsProgramDriver.testkit.ts";

describe("DirtyloopsProgramDriver process boundary", () => {
  it.effect("binds the executable to one regular file inside the installed skill closure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-closure-",
      });
      const installedRoot = path.join(fixtureRoot, "installed");
      const driverPath = path.join(installedRoot, "scripts", "program-driver.mjs");
      const outsidePath = path.join(fixtureRoot, "outside-driver.mjs");
      yield* fileSystem.makeDirectory(path.dirname(driverPath), { recursive: true });
      yield* fileSystem.writeFileString(driverPath, "export {};\n");
      yield* fileSystem.writeFileString(outsidePath, "export {};\n");

      const resolved = yield* resolveDirtyloopsDriverClosure(installedRoot);
      expect(resolved).toEqual({ installedSkillRoot: installedRoot, driverPath });

      yield* fileSystem.remove(driverPath);
      yield* fileSystem.symlink(outsidePath, driverPath);
      const result = yield* Effect.result(resolveDirtyloopsDriverClosure(installedRoot));
      assert(Result.isFailure(result));
      expect(result.failure.reason).toContain("installed dirtyloops closure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("pins a canonical installed root when a configured alias is retargeted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-root-alias-",
      });
      const firstRoot = path.join(fixtureRoot, "first");
      const secondRoot = path.join(fixtureRoot, "second");
      const aliasRoot = path.join(fixtureRoot, "installed");
      for (const root of [firstRoot, secondRoot]) {
        yield* fileSystem.makeDirectory(path.join(root, "scripts"), { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(root, "scripts", "program-driver.mjs"),
          "export {};\n",
        );
      }
      yield* fileSystem.symlink(firstRoot, aliasRoot);

      const resolved = yield* resolveDirtyloopsDriverClosure(aliasRoot);
      yield* fileSystem.remove(aliasRoot);
      yield* fileSystem.symlink(secondRoot, aliasRoot);

      expect(resolved).toEqual({
        installedSkillRoot: firstRoot,
        driverPath: path.join(firstRoot, "scripts", "program-driver.mjs"),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("bounds repeated read-only decision activity", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsProgramDriver({
        ...options,
        invoke: (current) =>
          Effect.succeed({
            ...raw,
            programRevision: current.observedProgramRevision + 1,
            graph: { ...raw.graph, observedAt: current.occurredAt },
          }),
      });
      let projection: ProgramProjection = input.observedProjection;
      for (let revision = 0; revision < 150; revision += 1) {
        const decision = yield* driver.reconcile({
          ...input,
          observedProgramRevision: projection.revision,
          observedProjection: projection,
          occurredAt: `2026-08-22T12:${String(revision % 60).padStart(2, "0")}:00.000Z`,
        });
        projection = decision.projection;
      }

      expect(projection.activity).toHaveLength(100);
      expect(projection.activity.at(-1)?.message).toBe("Canonical graph compiled.");
    }),
  );

  it.live("allows combined Admission checks beyond the legacy 15-second limit", () =>
    Effect.gen(function* () {
      const output = yield* encodeDirtyloopsDecisionJson(raw);
      const outputBase64 = Buffer.from(output).toString("base64");
      const invoke = yield* makeDirtyloopsProcessInvoker({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdin.resume(); process.stdin.on("end", () => setTimeout(() => process.stdout.write(Buffer.from("${outputBase64}", "base64")), 15500))`,
        ],
        cwd: process.cwd(),
      });

      const result = yield* invoke(input);
      expect(result).toEqual(raw);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("bounds child output in bytes and classifies process failures", () =>
    Effect.gen(function* () {
      const invoke = (
        source: string,
        extra: {
          readonly maxStdoutBytes?: number;
          readonly maxStderrBytes?: number;
          readonly timeoutMillis?: number;
        } = {},
      ) =>
        makeDirtyloopsProcessInvoker({
          executable: process.execPath,
          args: ["-e", source],
          cwd: process.cwd(),
          maxStdoutBytes: 5,
          maxStderrBytes: 5,
          ...extra,
        }).pipe(
          Effect.flatMap((run) => run(input)),
          Effect.result,
          Effect.map((result) => {
            assert(Result.isFailure(result));
            return result.failure;
          }),
        );

      expect((yield* invoke('process.stdout.write("123456")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect((yield* invoke('process.stderr.write("123456")')).reason).toContain(
        "stderr exceeded 5 bytes",
      );
      expect((yield* invoke('process.stdout.write("ééé")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect(
        (yield* invoke('process.stdout.write("not-json")', { maxStdoutBytes: 64 })).reason,
      ).toContain("process invocation failed");
      expect(
        (yield* invoke('process.stderr.write("nope"); process.exit(7)', {
          maxStderrBytes: 64,
        })).reason,
      ).toContain("exited with 7: nope");
      expect(
        (yield* invoke("setTimeout(() => undefined, 1000)", { timeoutMillis: 20 })).reason,
      ).toContain("process invocation failed");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
