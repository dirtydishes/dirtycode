# Remote SSH Environments via Managed `dirtycode-server`

## Summary

- Add a first-class SSH execution target for threads, backed by a managed remote runtime called `dirtycode-server`.
- Keep the connection private by default: the remote runtime listens only on `127.0.0.1` on the VPS, and the local app reaches it through an SSH tunnel.
- Save SSH servers centrally in a new settings section named **Remote Environments (SSH)**.
- Save remote repo mappings per local project per server, so one VPS can host multiple repos and multiple local projects can target the same server.
- Default remote thread behavior is isolated work: first send creates or reuses a remote feature branch/worktree rather than editing the remote default branch directly.
- PR creation is remote-first: commit/push/PR happen on the VPS, then the app offers a one-click local handoff that checks out the PR locally and opens a normal local review thread.
- v1 scope is Linux VPSes only (`x64` and `arm64`), SSH key/agent auth only, standalone install as the recommended path, Docker install as a prominent alternative.
- Do not store sudo passwords. Prefer user-level install, and fall back to interactive sudo only for install/repair steps that truly require it.

## Product Behavior

- In the draft-thread environment picker, add a third option with a cloud icon: `SSH server`.
- Keep `Local` and `New worktree` as they are for local execution.
- When `SSH server` is selected, show an adjacent server picker and a remote repo status pill for the selected project/server binding.
- Remote threads always require a bound remote repo path before first send. If the repo does not exist remotely, the setup flow can clone it from the local repo's `origin` URL.
- First send for a remote thread performs: tunnel connect, remote runtime health check, repo binding validation, remote branch/worktree creation, provider session start, then turn dispatch.
- Remote threads display a clear `Remote` badge in the header/sidebar and show the selected server nickname.
- Git actions on a remote thread use remote git state and remote git execution, not the local filesystem.
- After `create_pr` or `commit_push_pr` succeeds remotely, show CTA buttons for `Open PR` and `Create local review thread`.
- `Create local review thread` uses the existing local PR checkout flow against the local repo and lands the user in a normal local/local-worktree thread for review and follow-up.
- Unsupported local-only actions on live remote threads are disabled with explicit copy in v1: terminal drawer, open in local editor, save plan to workspace, diff/checkpoint panels that depend on local paths.

## Architecture

- Create a new deployable workspace: `apps/dirtycode-server`.
- Extract reusable provider-session and git-runtime code from `apps/server` into a new server-only shared workspace, `packages/runtime-core`, to avoid duplicating Codex session management and git workflows.
- `apps/dirtycode-server` hosts a localhost-only JSON-RPC/WebSocket control API for health, repo binding, git actions, and Codex session/event streaming.
- `apps/server` gains a remote control layer with `RemoteEnvironmentRegistry`, `SshTunnelManager`, `RemoteBootstrapService`, and `DirtycodeServerClient`.
- The local server remains the source of truth for orchestration and UI-facing state. The remote runtime is an execution backend, not a second UI/orchestration product.
- Provider kind stays `codex`; SSH is modeled as an execution target, not as a new provider.
- Persist remote runtime resumability in two places: local server stores thread-to-remote binding metadata, and the remote runtime stores its own session state under `~/.dirtycode-server/state`.
- Add explicit version negotiation between local `apps/server` and remote `dirtycode-server`; refuse control when major versions are incompatible and surface an `Upgrade remote runtime` action.

## Setup and Install Flow

- Add a settings section: **Remote Environments (SSH)**.
- Each server entry stores: `id`, `nickname`, `host`, `port`, `username`, `authMode` (`agent` or `keyFile`), optional `keyFilePath`, `preferredInstallMode` (`standalone` or `docker`), optional `defaultBaseDir`, and cached health/install metadata.
- v1 does not store passwords and does not implement password auth.
- Add two prominent install buttons on each server card:
- `Quick Install` uses a standalone, non-Docker path and is the recommended primary CTA.
- `Install with Docker` is equally visible but secondary.
- Both install paths begin with the same SSH preflight: host key check, OS/arch detection, `git` presence, `ssh` presence, disk space, remote auth status for `codex`, optional `gh` presence, and repo binding validation.
- Standalone install places the runtime under `~/.dirtycode-server`, installs/updates a pinned runtime bundle, and creates a user service when `systemd --user` is available; otherwise it runs as a supervised background process.
- Docker install creates a managed container that binds only to remote loopback and mounts the repo root plus credential/config paths needed for Codex auth.
- Both install flows are idempotent and can be rerun as `Repair` or `Upgrade`.
- Sudo policy:
- Default to no sudo.
- If Docker or missing system packages require privilege, prompt the user for interactive sudo during that install step only.
- Never persist sudo credentials to disk or reusable app settings.

## Repo Binding and Git Ownership

- Add server-authoritative per-project remote bindings in settings keyed by `{projectId, serverId}`.
- Each binding stores: `remoteRepoPath`, `cloneUrl`, `defaultBranch`, `lastVerifiedAt`, `expectedOriginUrl`, and `installModeOverride` when needed.
- Default `cloneUrl` comes from the local repo's `origin`; if no usable origin exists, the user must provide one in settings before remote use.
- On verification, compare the remote repo's `origin` URL and default branch against the saved binding and show drift warnings instead of silently proceeding.
- Remote git status, branch detection, push, and PR creation all run on the VPS for remote threads.
- Local git status continues to power local and worktree threads exactly as it does today.

## Public API and Type Changes

### `packages/contracts/src/settings.ts`

- Add `RemoteEnvironment`, `RemoteEnvironmentHealth`, `RemoteProjectBinding`, and corresponding patch schemas under server settings.

### `packages/contracts/src/orchestration.ts`

- Add `ThreadExecutionTarget = { kind: "local" } | { kind: "ssh"; serverId: string; remoteRepoPath: string; remoteWorkspacePath: string | null }`.
- Add `executionTarget` to `ThreadCreateCommand`, `ThreadMetaUpdateCommand`, `OrchestrationThread`, `thread.created`, and `thread.meta-updated`.
- Keep existing local `branch` and `worktreePath`; for SSH threads, `worktreePath` remains `null` locally and remote workspace paths live under `executionTarget`.

### Draft thread state in `apps/web`

- Replace the draft-only `envMode` assumption with a richer launch model that can represent `local`, `worktree`, or `ssh` plus selected `serverId`.

### `packages/contracts/src/server.ts`

- Add remote environment snapshots to server config/settings updates so the UI can render health/install state without extra ad hoc polling.
- Add remote-control RPC contracts for `remote.install`, `remote.verify`, `remote.listBindings`, `remote.upsertEnvironment`, and `remote.deleteEnvironment`.
- Add execution-aware git RPC inputs using a `GitWorkspaceRef` union: `{ kind: "local"; cwd: string } | { kind: "remote"; threadId: ThreadId }`.

## UI Implementation Map

### `apps/web/src/components/settings/SettingsPanels.tsx`

- Add the full Remote Environments (SSH) section with cards, health states, install buttons, verify/repair actions, and per-project binding editor.

### `apps/web/src/components/BranchToolbar.tsx` and draft-thread state

- Add the cloud option and server picker.
- Keep existing local/new-worktree behavior unchanged.

### `apps/web/src/components/ChatView.tsx`

- Gate first-send bootstrap on remote readiness, show remote-specific progress copy, and persist `executionTarget` on thread creation.

### `apps/web/src/components/GitActionsControl.tsx`

- Switch from `cwd`-only assumptions to execution-aware status/actions, and add the post-PR local handoff CTA.

### `apps/web/src/components/Sidebar.tsx`

- Show remote badges, selected server nickname, and remote-state indicators on remote threads.

## Reliability and Performance Requirements

- Use a long-lived SSH control connection per server and multiplex tunnels over it to avoid reconnect overhead on every turn.
- Keep the remote runtime warm and reuse remote Codex sessions by thread id whenever possible.
- Stream provider events over the tunnel as incremental events, not polled snapshots.
- Cache remote health and repo verification aggressively, but invalidate on install/repair, settings changes, and SSH reconnect.
- Fail closed on host key mismatch, runtime version mismatch, or repo identity drift.
- If the tunnel drops mid-turn, preserve the local thread in a recoverable state and offer `Reconnect` rather than marking the turn unrecoverably failed immediately.

## Test Cases and Scenarios

- Contract tests for new settings, execution target, binding, and remote RPC schemas.
- Browser tests for settings CRUD, install CTA states, environment picker behavior, first-send bootstrap, and remote-thread header/sidebar badges.
- Integration tests for SSH tunnel lifecycle, remote health checks, remote session start/resume/stop, and remote event streaming through the local server.
- Git integration tests for remote status, commit/push/PR flows, and local handoff creation after remote PR success.
- Failure-path tests for: missing remote runtime, missing repo, clone failure, repo drift, incompatible remote version, Codex unavailable remotely, `gh` missing remotely, and SSH disconnect during a running turn.
- Regression tests proving local threads and local worktree flows are unchanged.

## Assumptions and Defaults

- v1 supports only Linux VPS targets on `x64` and `arm64`.
- v1 supports only SSH agent auth and explicit key-file auth; password auth is out of scope.
- The remote runtime is never publicly exposed in v1; all traffic goes through SSH tunneling.
- Remote threads always default to isolated feature-branch/worktree execution.
- `Quick Install` is the recommended path; Docker remains available but not the default.
- PR creation happens remotely first, then local handoff is offered automatically.
- The remote terminal drawer, local editor open, local path links, local workspace save, and local diff/checkpoint features remain disabled on live remote threads in v1.
- The most important "don't forget" items are host-key pinning, remote/local repo drift detection, remote runtime version negotiation, cleanup of stale remote worktrees, and very explicit UX copy when a feature is disabled because the thread is remote.
