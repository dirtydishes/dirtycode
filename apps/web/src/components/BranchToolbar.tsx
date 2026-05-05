import type { ThreadId } from "@t3tools/contracts";
import { CloudIcon, FolderIcon, GitForkIcon } from "lucide-react";
import { useCallback } from "react";

import { useSettings } from "../hooks/useSettings";
import { newCommandId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import {
  EnvMode,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
} from "./BranchToolbar.logic";
import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const envModeItems = [
  { value: "local", label: "Local" },
  { value: "worktree", label: "New worktree" },
  { value: "ssh", label: "SSH server" },
] as const;

interface BranchToolbarProps {
  threadId: ThreadId;
  onEnvModeChange: (mode: EnvMode) => void;
  onServerIdChange: (serverId: string | null) => void;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

export default function BranchToolbar({
  threadId,
  onEnvModeChange,
  onServerIdChange,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarProps) {
  const settings = useSettings();
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const serverThread = threads.find((thread) => thread.id === threadId);
  const activeProjectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch = serverThread?.branch ?? draftThread?.branch ?? null;
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const branchCwd = activeWorktreePath ?? activeProject?.cwd ?? null;
  const hasServerThread = serverThread !== undefined;
  const selectedServerId =
    serverThread?.executionTarget?.kind === "ssh"
      ? serverThread.executionTarget.serverId
      : (draftThread?.serverId ?? null);
  const remoteEnvironments = settings.remoteEnvironments;
  const remoteBinding =
    activeProjectId && selectedServerId
      ? (settings.remoteProjectBindings.find(
          (binding) =>
            binding.projectId === activeProjectId && binding.serverId === selectedServerId,
        ) ?? null)
      : null;
  const effectiveEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    executionTargetKind: serverThread?.executionTarget?.kind,
    hasServerThread,
    draftThreadEnvMode: draftThread?.envMode,
  });

  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId) return;
      const api = readNativeApi();
      // If the effective cwd is about to change, stop the running session so the
      // next message creates a new one with the correct cwd.
      if (serverThread?.session && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          branch,
          worktreePath,
        });
      }
      if (hasServerThread) {
        setThreadBranchAction(activeThreadId, branch, worktreePath);
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(threadId, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
      });
    },
    [
      activeThreadId,
      serverThread?.session,
      activeWorktreePath,
      hasServerThread,
      setThreadBranchAction,
      setDraftThreadContext,
      threadId,
      effectiveEnvMode,
    ],
  );

  if (!activeThreadId || !activeProject) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pb-3 pt-1">
      {envLocked || activeWorktreePath || (hasServerThread && effectiveEnvMode === "ssh") ? (
        <span className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
          {effectiveEnvMode === "ssh" ? (
            <>
              <CloudIcon className="size-3" />
              SSH server
            </>
          ) : activeWorktreePath ? (
            <>
              <GitForkIcon className="size-3" />
              Worktree
            </>
          ) : (
            <>
              <FolderIcon className="size-3" />
              Local
            </>
          )}
        </span>
      ) : (
        <Select
          value={effectiveEnvMode}
          onValueChange={(value) => onEnvModeChange(value as EnvMode)}
          items={envModeItems}
        >
          <SelectTrigger variant="ghost" size="xs" className="font-medium">
            {effectiveEnvMode === "worktree" ? (
              <GitForkIcon className="size-3" />
            ) : effectiveEnvMode === "ssh" ? (
              <CloudIcon className="size-3" />
            ) : (
              <FolderIcon className="size-3" />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="local">
              <span className="inline-flex items-center gap-1.5">
                <FolderIcon className="size-3" />
                Local
              </span>
            </SelectItem>
            <SelectItem value="worktree">
              <span className="inline-flex items-center gap-1.5">
                <GitForkIcon className="size-3" />
                New worktree
              </span>
            </SelectItem>
            <SelectItem value="ssh">
              <span className="inline-flex items-center gap-1.5">
                <CloudIcon className="size-3" />
                SSH server
              </span>
            </SelectItem>
          </SelectPopup>
        </Select>
      )}

      <div className="flex items-center gap-2">
        {effectiveEnvMode === "ssh" ? (
          <>
            <Select
              value={selectedServerId ?? ""}
              onValueChange={(value) => onServerIdChange(value || null)}
            >
              <SelectTrigger className="w-[180px]" aria-label="SSH server">
                <SelectValue>{selectedServerId ? null : "Select server"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {remoteEnvironments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.id}>
                    {environment.nickname}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="inline-flex min-h-8 items-center rounded-md border border-border/70 px-2.5 text-xs font-medium text-muted-foreground">
              {remoteBinding ? "Repo bound" : "Auto-bind on first send"}
            </span>
          </>
        ) : (
          <BranchToolbarBranchSelector
            activeProjectCwd={activeProject.cwd}
            activeThreadBranch={activeThreadBranch}
            activeWorktreePath={activeWorktreePath}
            branchCwd={branchCwd}
            effectiveEnvMode={effectiveEnvMode}
            envLocked={envLocked}
            onSetThreadBranch={setThreadBranch}
            {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        )}
      </div>
    </div>
  );
}
