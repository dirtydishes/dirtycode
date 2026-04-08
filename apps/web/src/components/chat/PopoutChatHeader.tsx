import { memo } from "react";
import { ArrowUpRightIcon, XIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface PopoutChatHeaderProps {
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  onFocusMainThread: () => void;
  onCloseWindow: () => void;
}

export const PopoutChatHeader = memo(function PopoutChatHeader({
  activeThreadTitle,
  activeProjectName,
  onFocusMainThread,
  onCloseWindow,
}: PopoutChatHeaderProps) {
  return (
    <div className="@container/popout-header flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName ? (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="shrink-0"
          onClick={onFocusMainThread}
        >
          <ArrowUpRightIcon className="size-3.5" />
          <span className="hidden @3xl/popout-header:inline">Open in main</span>
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="shrink-0"
          aria-label="Close pop-out window"
          onClick={onCloseWindow}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
});
