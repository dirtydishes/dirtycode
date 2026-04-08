import { ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";

function PopoutThreadRouteView() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );

  if (!bootstrapComplete) {
    return null;
  }

  if (!threadExists && !draftThreadExists) {
    return (
      <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
        <header className="drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-sm font-medium">Thread unavailable</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="shrink-0"
            onClick={() => window.close()}
          >
            Close
          </Button>
        </header>
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">
            This thread is no longer available in the current session.
          </p>
        </div>
      </div>
    );
  }

  return <ChatView threadId={threadId} presentation="popout" />;
}

export const Route = createFileRoute("/popout/$threadId")({
  component: PopoutThreadRouteView,
});
