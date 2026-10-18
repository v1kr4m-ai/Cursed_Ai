import { StudioPage } from "../comfy/StudioPage";

/** Image Studio: Cloud (Gemini), Local Quick and Local Workflows share one layout (see comfy/StudioPage). */
export function ImageGeneratorView({ modelId }: { modelId?: string }) {
  return <StudioPage kind="image" modelId={modelId} />;
}
