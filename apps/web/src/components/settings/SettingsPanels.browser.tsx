import "../../index.css";

import { DEFAULT_SERVER_SETTINGS, type NativeApi, type ServerConfig } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { GeneralSettingsPanel, RemoteControlSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe("Settings panels", () => {
  beforeEach(async () => {
    resetServerStateForTests();
    await __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    resetServerStateForTests();
    await __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect.element(page.getByText("Open logs folder")).toBeInTheDocument();
    await expect
      .element(page.getByText("/repo/project/.t3/logs", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<NativeApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("keeps added SSH servers after a stale config snapshot arrives", async () => {
    const deferredSettings = createDeferredPromise<ServerConfig["settings"]>();
    const updateSettings = vi
      .fn<NativeApi["server"]["updateSettings"]>()
      .mockReturnValue(deferredSettings.promise);

    window.nativeApi = {
      server: {
        updateSettings,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <RemoteControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByText("Add server").click();

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="SSH server nickname"]')).not.toBeNull();
    });

    setServerConfigSnapshot(createBaseServerConfig());

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="SSH server nickname"]')).toBeNull();
    });

    deferredSettings.resolve({
      ...DEFAULT_SERVER_SETTINGS,
      remoteEnvironments: [
        {
          id: "ssh-server-1",
          nickname: "SSH server 1",
          host: "example.com",
          port: 22,
          username: "ubuntu",
          authMode: "agent",
          keyFilePath: null,
          preferredInstallMode: "standalone",
          defaultBaseDir: null,
          health: {
            status: "unknown",
            installStatus: "unknown",
            checkedAt: null,
            runtimeVersion: null,
          },
        },
      ],
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="SSH server nickname"]')).not.toBeNull();
    });
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it("shows tailnet host guidance and the advanced repo bindings section", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <RemoteControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByText(/Hosts can be public DNS\/IP, MagicDNS/))
      .toBeInTheDocument();
    await expect.element(page.getByText("Advanced project repo bindings")).toBeInTheDocument();
  });
});
