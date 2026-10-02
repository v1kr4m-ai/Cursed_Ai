import React from "react";
import { Folder, FolderOpen, ChevronUp, Loader2, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPath?: string;
  onSelect: (path: string) => void;
}

/**
 * A real filesystem folder browser, backed by /api/browse-directory. A plain
 * web page has no native OS folder-picker that can hand back a real
 * absolute path, so this is the actual way to click through disk instead of
 * typing a path by hand.
 */
export function FolderPickerDialog({ open, onOpenChange, initialPath, onSelect }: FolderPickerDialogProps) {
  const [currentPath, setCurrentPath] = React.useState("");
  const [parentPath, setParentPath] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<Entry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const browse = React.useCallback(async (targetPath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/browse-directory?path=${encodeURIComponent(targetPath)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to browse");
      setCurrentPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) browse(initialPath || "");
  }, [open, browse, initialPath]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose Models Folder</DialogTitle>
          <DialogDescription>Browsing this machine's real filesystem.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2">
            <FolderOpen size={14} className="text-violet-400 shrink-0" />
            <span className="text-xs font-mono text-zinc-300 truncate">{currentPath || "Drives"}</span>
          </div>

          <div className="h-72 overflow-y-auto rounded-xl bg-black/20 divide-y divide-white/5">
            {isLoading && (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <Loader2 className="animate-spin" size={20} />
              </div>
            )}
            {error && (
              <div className="p-4 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}
            {!isLoading && !error && (
              <>
                {parentPath !== null && (
                  <button
                    onClick={() => browse(parentPath)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-zinc-400 hover:bg-white/5 transition-colors text-sm"
                  >
                    <ChevronUp size={16} /> ..
                  </button>
                )}
                {entries.length === 0 && parentPath !== null && (
                  <p className="p-4 text-xs text-zinc-600 text-center">No subfolders here</p>
                )}
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => browse(entry.path)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-zinc-300 hover:bg-white/5 transition-colors text-sm"
                  >
                    <Folder size={16} className="text-violet-400 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onSelect(currentPath);
              onOpenChange(false);
            }}
            disabled={!currentPath}
            className="bg-violet-600 hover:bg-violet-500 text-white font-bold"
          >
            Select This Folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
