import { createProgramEnvironmentAtoms } from "@t3tools/client-runtime/state/programs";

import { connectionAtomRuntime } from "../connection/runtime";

export const programEnvironment = createProgramEnvironmentAtoms(connectionAtomRuntime);
