import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { type SshRepoBootstrapCoreDeps, bootstrapSshRepoBindingWithDeps } from "./SshRepoBootstrap";

function makeBaseDeps(overrides: Partial<SshRepoBootstrapCoreDeps> = {}): SshRepoBootstrapCoreDeps {
  const settings: typeof DEFAULT_SERVER_SETTINGS = {
    ...DEFAULT_SERVER_SETTINGS,
    remoteEnvironments: [
      {
        id: "server-1",
        nickname: "SSH server 1",
        host: "mybox.tail123.ts.net",
        port: 22,
        username: "ubuntu",
        authMode: "agent",
        keyFilePath: null,
        preferredInstallMode: "standalone",
        defaultBaseDir: "/srv",
        health: {
          status: "unknown",
          installStatus: "unknown",
          checkedAt: null,
          runtimeVersion: null,
        },
      },
    ],
  };

  return {
    getSnapshot: async () => ({
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          title: "Project One",
          workspaceRoot: "/repo/project-one",
          deletedAt: null,
        },
      ],
    }),
    getSettings: async () => settings,
    updateSettings: async () => undefined,
    isInsideWorkTree: async () => true,
    readConfigValue: async () => "git@github.com:owner/repo.git",
    readLocalDefaultBranch: async () => "main",
    runSshScript: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
    now: () => "2026-04-16T12:00:00.000Z",
    ...overrides,
  };
}

describe("SshRepoBootstrap", () => {
  it("maps tailnet DNS failures to ssh_tailnet_dns_unresolved", async () => {
    const deps = makeBaseDeps({
      runSshScript: async () => ({
        code: 255,
        stdout: "",
        stderr: "ssh: Could not resolve hostname mybox.tail123.ts.net: Name or service not known",
        timedOut: false,
      }),
    });

    await expect(
      bootstrapSshRepoBindingWithDeps(
        { projectId: ProjectId.makeUnsafe("project-1"), serverId: "server-1" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "ssh_tailnet_dns_unresolved" });
  });

  it("maps tailnet unreachable failures to ssh_tailnet_unreachable", async () => {
    const deps = makeBaseDeps({
      runSshScript: async () => ({
        code: 255,
        stdout: "",
        stderr: "ssh: connect to host 100.101.102.103 port 22: Connection timed out",
        timedOut: false,
      }),
    });

    await expect(
      bootstrapSshRepoBindingWithDeps(
        { projectId: ProjectId.makeUnsafe("project-1"), serverId: "server-1" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "ssh_tailnet_unreachable" });
  });

  it("maps tailnet permission failures to ssh_tailnet_acl_denied", async () => {
    const deps = makeBaseDeps({
      runSshScript: async () => ({
        code: 255,
        stdout: "",
        stderr: "Permission denied (publickey).",
        timedOut: false,
      }),
    });

    await expect(
      bootstrapSshRepoBindingWithDeps(
        { projectId: ProjectId.makeUnsafe("project-1"), serverId: "server-1" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "ssh_tailnet_acl_denied" });
  });

  it("continues through clone, verify, and settings persistence after successful tailnet preflight", async () => {
    const updateSettings = vi.fn(async () => undefined);
    const runSshScript = vi
      .fn<SshRepoBootstrapCoreDeps["runSshScript"]>()
      .mockResolvedValueOnce({
        code: 0,
        stdout: "__T3_PRECHECK_OK__\n",
        stderr: "",
        timedOut: false,
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "__T3_REPO_STATE__=missing\n",
        stderr: "",
        timedOut: false,
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "__T3_ORIGIN__=git@github.com:owner/repo.git\n__T3_DEFAULT_BRANCH__=main\n",
        stderr: "",
        timedOut: false,
      });

    const deps = makeBaseDeps({ runSshScript, updateSettings });

    const result = await bootstrapSshRepoBindingWithDeps(
      { projectId: ProjectId.makeUnsafe("project-1"), serverId: "server-1" },
      deps,
    );

    expect(result.hostClassification).toBe("tailnet");
    expect(result.createdBinding).toBe(true);
    expect(result.cloned).toBe(true);
    expect(result.binding.remoteRepoPath).toBe("/srv/project-one");
    expect(updateSettings).toHaveBeenCalledOnce();
  });
});
