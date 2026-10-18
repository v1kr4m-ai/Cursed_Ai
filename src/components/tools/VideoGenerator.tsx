import { StudioPage } from "../comfy/StudioPage";

/** Video Studio: Cloud (Veo), Local Quick and Local Workflows share one layout (see comfy/StudioPage). */
export function VideoGeneratorView({ modelId }: { modelId?: string }) {
  return <StudioPage kind="video" modelId={modelId} />;
}
