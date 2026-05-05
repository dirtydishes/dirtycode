// This file mostly exists because we want dev mode to say "T3 Code (Dev)" instead of "electron"

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment ? "T3 Code (Dev)" : "T3 Code (Alpha)";
const APP_BUNDLE_ID = isDevelopment ? "com.t3tools.t3code.dev" : "com.t3tools.t3code";
const LAUNCHER_VERSION = 2;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const defaultIconPath = join(desktopDir, "resources", "icon.icns");
const developmentMacIconPngPath = join(repoRoot, "assets", "dev", "blueprint-macos-1024.png");

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function ensureDevelopmentIconIcns(runtimeDir) {
  const generatedIconPath = join(runtimeDir, "icon-dev.icns");
  mkdirSync(runtimeDir, { recursive: true });

  if (!existsSync(developmentMacIconPngPath)) {
    return defaultIconPath;
  }

  const sourceMtimeMs = statSync(developmentMacIconPngPath).mtimeMs;
  if (existsSync(generatedIconPath) && statSync(generatedIconPath).mtimeMs >= sourceMtimeMs) {
    return generatedIconPath;
  }

  const iconsetRoot = mkdtempSync(join(runtimeDir, "dev-iconset-"));
  const iconsetDir = join(iconsetRoot, "icon.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } catch (error) {
    console.warn(
      "[desktop-launcher] Failed to generate dev macOS icon, falling back to default icon.",
      error,
    );
    return defaultIconPath;
  } finally {
    rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function getElectronPlatformPath() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "linux":
    case "openbsd":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${process.platform}`);
  }
}

function inspectElectronRuntime(electronPackageDir) {
  const pathFilePath = join(electronPackageDir, "path.txt");
  const pathFromFile = readText(pathFilePath);
  const executableRelativePath = pathFromFile || getElectronPlatformPath();
  const distBasePath = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(electronPackageDir, "dist");
  const executablePath = join(distBasePath, executableRelativePath);
  const missingArtifacts = [];

  if (!pathFromFile) {
    missingArtifacts.push(pathFilePath);
  }
  if (!existsSync(distBasePath)) {
    missingArtifacts.push(distBasePath);
  }
  if (!existsSync(executablePath)) {
    missingArtifacts.push(executablePath);
  }

  return { missingArtifacts, pathFilePath, distBasePath, executablePath };
}

function formatOutputSnippet(label, output) {
  if (!output || !output.trim()) {
    return `${label}: <empty>`;
  }

  const cleaned = output.trim();
  const truncated = cleaned.length > 1200 ? `${cleaned.slice(0, 1200)}\n...<truncated>` : cleaned;
  return `${label}:\n${truncated}`;
}

function createElectronRepairMessage({
  electronPackageVersion,
  electronPackageDir,
  preInstallState,
  postInstallState,
  installResult,
  skipDownload,
}) {
  const missingBefore = preInstallState.missingArtifacts.map((item) => `- ${item}`).join("\n");
  const missingAfter = postInstallState.missingArtifacts.map((item) => `- ${item}`).join("\n");
  const remediation = `rm -rf node_modules/.bun/electron@${electronPackageVersion} && bun install`;

  if (skipDownload) {
    return [
      "Electron runtime artifacts are missing, but ELECTRON_SKIP_BINARY_DOWNLOAD is set.",
      `electron package directory: ${electronPackageDir}`,
      "missing artifacts:",
      missingBefore,
      "unset ELECTRON_SKIP_BINARY_DOWNLOAD and reinstall Electron.",
      `manual recovery: ${remediation}`,
    ].join("\n");
  }

  const status =
    installResult.status !== null
      ? `exit code ${installResult.status}`
      : `signal ${installResult.signal ?? "unknown"}`;

  return [
    "Electron runtime auto-repair failed.",
    `electron package directory: ${electronPackageDir}`,
    "missing artifacts before repair:",
    missingBefore,
    "missing artifacts after repair:",
    missingAfter || "- <none>",
    `install.js result: ${status}`,
    formatOutputSnippet("install stdout", installResult.stdout),
    formatOutputSnippet("install stderr", installResult.stderr),
    `manual recovery: ${remediation}`,
  ].join("\n");
}

function ensureElectronRuntimeInstalled(require) {
  const electronPackageJsonPath = require.resolve("electron/package.json");
  const electronPackageDir = dirname(electronPackageJsonPath);
  const electronPackageJson = readJson(electronPackageJsonPath);
  const electronPackageVersion = electronPackageJson?.version || "unknown";
  const preInstallState = inspectElectronRuntime(electronPackageDir);

  if (preInstallState.missingArtifacts.length === 0) {
    return;
  }

  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    throw new Error(
      createElectronRepairMessage({
        electronPackageVersion,
        electronPackageDir,
        preInstallState,
        postInstallState: preInstallState,
        installResult: { status: null, signal: null, stdout: "", stderr: "" },
        skipDownload: true,
      }),
    );
  }

  console.warn(
    "[desktop] Electron runtime artifacts are missing; attempting automatic repair via electron/install.js",
  );

  const installScriptPath = join(electronPackageDir, "install.js");
  const installResult = spawnSync("node", [installScriptPath], {
    cwd: electronPackageDir,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  const postInstallState = inspectElectronRuntime(electronPackageDir);

  if (installResult.status === 0 && postInstallState.missingArtifacts.length === 0) {
    return;
  }

  throw new Error(
    createElectronRepairMessage({
      electronPackageVersion,
      electronPackageDir,
      preInstallState,
      postInstallState,
      installResult,
      skipDownload: false,
    }),
  );
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = isDevelopment ? ensureDevelopmentIconIcns(runtimeDir) : defaultIconPath;
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  ensureElectronRuntimeInstalled(require);
  const electronBinaryPath = require("electron");

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  // Dev launches do not need a renamed app bundle badly enough to risk breaking
  // Electron helper resource lookup on macOS.
  if (isDevelopment) {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}
