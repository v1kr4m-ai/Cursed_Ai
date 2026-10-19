import React from "react";
import { Clapperboard, ImagePlus } from "lucide-react";
import { DirectStudio } from "./DirectStudio";
import { StudioToolbar, Source } from "./StudioToolbar";
import { useLocalMode } from "./ModeSwitch";
import { WorkflowRunner } from "./WorkflowRunner";
import { Kind } from "./types";
import { savedSetting } from "../../lib/settingsStore";

/**
 * The Image / Video page. One layout for every mode - Cloud, Local Quick and Local Workflows - with the same top bar,
 * prompt-from-file, queue, recent results and History.
 */
export function StudioPage({ kind, modelId }: { kind: Kind; modelId?: string }) {
  // Local (offline) is the default; Cloud is the second choice. The last pick is remembered per tab.
  const [source, setSourceState] = React.useState<Source>(() => { try { const v = localStorage.getItem(`cursed.source.${kind}`); return v === "cloud" || v === "local" ? v : savedSetting("defaultSource", "local"); } catch { return "local"; } });
  const setSource = (s: Source) => { setSourceState(s); try { localStorage.setItem(`cursed.source.${kind}`, s); } catch { /* private window */ } };
  const [mode, setMode] = useLocalMode(kind);
  const [showHistory, setShowHistory] = React.useState(false);
  const icon = kind === "image" ? <ImagePlus className="text-pink-500" size={24} /> : <Clapperboard className="text-orange-500" size={24} />;
  const toolbar = (
    <StudioToolbar kind={kind} icon={icon} title={kind === "image" ? "Image Studio" : "Video Studio"} source={source} onSource={setSource} mode={mode} onMode={setMode} showHistory={showHistory} onHistory={() => setShowHistory(h => !h)} />
  );
  const workflows = source === "local" && mode === "workflows";
  return (
    <div className="flex-1 bg-transparent p-4 h-full overflow-hidden">
      <div className="max-w-[1600px] mx-auto h-full">
        {workflows
          ? <WorkflowRunner kind={kind} modelId={modelId} toolbar={toolbar} showHistory={showHistory} onCloseHistory={() => setShowHistory(false)} />
          : <DirectStudio key={`${kind}-${source}`} kind={kind} engine={source === "cloud" ? "cloud" : "quick"} modelId={modelId} toolbar={toolbar} showHistory={showHistory} onCloseHistory={() => setShowHistory(false)} />}
      </div>
    </div>
  );
}
