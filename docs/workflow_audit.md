# ComfyUI workflow audit

Read-only audit. Frontend-only virtual nodes (Note, MarkdownNote, Reroute, PrimitiveNode, rgthree Label/Fast Groups Muter/Bypasser from rgthree-comfy, SetNode/GetNode from ComfyUI-KJNodes) are not in /object_info by design and are not counted as missing. ComfyUI 0.30.0 at 127.0.0.1:8188, live /object_info. UI workflows: `F:\ComfyUI\ComfyUI_windows_portable\ComfyUI\user\default\workflows`; API-format copies: `API_FORMAT` subfolder. The app (comfyTool/store.ts `workflowFolder`) reads this same folder, so there are no separate app copies. No extra_model_paths.yaml exists. C:\pinokio does not exist.

Method: node type must exist in /object_info; every model-like string (.safetensors/.ckpt/.pt/.pth/.gguf/.onnx/.bin) in widgets_values/inputs must be among that node's combo options (file present in the right models subfolder). Subgraph inner nodes are included. Mode 2/4 (muted/bypassed) nodes are listed in Notes and their issues marked (muted), not counted as errors. ComfyUI-TeaCache failed to import, so its nodes appear as missing.

| Workflow | Fmt | Status | Missing nodes | Missing models | Notes |
|---|---|---|---|---|---|
| 3D - HyperSD with Blender (HyperSD Blender).json | UI | BROKEN |  | CheckpointLoaderSimple#162: `Hyper-SDXL-1step-Unet-Comfyui.fp16.safetensors`<br>ControlNetLoader#176: `sai_xl_depth_128lora.safetensors` |  |
| 3D - Image to 3D model (Hunyuan 3D).json | UI | BROKEN |  | Hy3DModelLoader#10: `hunyuan3d-dit-v2-0-fp16.safetensors` |  |
| 3D - Image to 3D model (Hunyuan3D 2.1).json | UI | OK |  |  |  |
| 3D - Image to 3D model, multiview (Hunyuan3D 2 MV).json | UI | OK |  |  |  |
| Audio - Text to song (ACE-Step).json | UI | OK |  |  | muted/bypassed: LoadAudio#64, VAEEncodeAudio#68 |
| Image - Character sheet v3 (Flux, Mickmumpitz).json | UI | OK |  |  | muted/bypassed: PreviewImage#141, ImageCrop#134, Reroute#149, PreviewImage#84, ImageScale#129, PreviewImage#138, PreviewImage#258, ImageCrop#142 |
| Image - Character sheet v5 (Flux, Mickmumpitz).json | UI | OK |  |  | muted/bypassed: PreviewImage#141, ImageCrop#134, Reroute#149, ImageScale#129, EmptySD3LatentImage#167, PreviewImage#138, CLIPTextEncode#157, RandomNoise#165 |
| Image - Consistent character (Flux).json | UI | OK |  |  |  |
| Image - Consistent character creator v3.6 (Flux Kontext, Mickmumpitz).json | UI | OK |  |  |  |
| Image - ControlNet Depth (ControlNet Depth).json | UI | BROKEN |  | ControlNetLoader#7: `control-lora-depth-rank256.safetensors` |  |
| Image - Edge guided text to image (Qwen Image ControlNet).json | UI | OK |  |  | muted/bypassed: LoraLoaderModelOnly#80 |
| Image - Funny Ultraman style pictures (Flux LoRA, OpenArt).json | UI | OK |  | LoraLoaderModelOnly#72: `Flux/aesthetic_anime_v1s.safetensors` (muted) | muted/bypassed: LoraLoaderModelOnly#72 |
| Image - Image to image (Img2Img).json | UI | OK |  |  |  |
| Image - Image variations with a text prompt (SDXL Revision).json | UI | OK |  |  |  |
| Image - Multi ControlNet (ControlNet).json | UI | OK |  |  |  |
| Image - Qwen_Image_2512_360Degree_lora.json | UI | OK |  |  |  |
| Image - Sketch to image (Sketch to Image).json | UI | OK |  |  |  |
| Image - Text and reference to image (Flux 2).json | UI | BROKEN |  | CLIPLoader#38: `mistral_3_small_flux2_bf16.safetensors` | UNETLoader#12: `flux1-dev-fp8.safetensors` is on disk at ['checkpoints/flux1-dev-fp8.safetensors'] but not offered by this loader<br>muted/bypassed: VAEEncode#40, LoadImage#42, ReferenceLatent#39, ImageScaleToTotalPixels#41, LoraLoaderModelOnly#67 |
| Image - Text to image (Chroma Radiance).json | UI | OK |  |  |  |
| Image - Text to image (Juggernaut XL).json | UI | OK |  |  |  |
| Image - Text to image (SD checkpoint).json | UI | OK |  |  |  |
| Image - Text to image (SDXL Default).json | UI | OK |  |  |  |
| Image - Text to image + 4x upscale (SD 1.5) v2.json | UI | OK |  |  |  |
| Image - Text to image + 4x upscale (SD 1.5).json | UI | OK |  |  |  |
| Image - Text to image with 2 reference images (Flux Dev fp8).json | UI | OK |  |  |  |
| Image - Text to image with LoRAs (Using LoRAs).json | UI | OK |  | LoraLoader#50: `Alien_God_sdxl_1.safetensors` (muted) | muted/bypassed: LoraLoader#50 |
| Image - Text to image with a reference image (Flux Dev fp8).json | UI | OK |  |  | muted/bypassed: CheckpointLoaderSimple#72, ConditioningZeroOut#79, LoadImage#91, LoadImage#46, VAEDecode#77, KSampler#78, EmptyLatentImage#87, SaveImage#73 |
| Image - Text to image with a reference image + upscale (SD 1.5, USO).json | UI | OK |  |  |  |
| Image - Text to image with reference images + upscale (Flux Kontext).json | UI | OK |  |  |  |
| Image - Text to image with several LoRAs (SD checkpoint).json | UI | OK |  |  |  |
| Image - Text to image with style presets (RealVis XL Lightning).json | UI | OK |  |  |  |
| Image - Text to image, minimal (DreamShaper 8).json | UI | OK |  |  |  |
| Image Edit - Character sheet from a photo (Qwen Image Edit).json | UI | OK |  |  |  |
| Image Edit - Combine 2 images (Merging 2 Images).json | UI | OK |  |  |  |
| Image Edit - Combine several images into one (Qwen Image Edit).json | UI | OK |  | LoraLoaderModelOnly#1289: `qwen/qwen-boreal-general-discrete-low-rank.safetensors` (muted) | muted/bypassed: LoraLoaderModelOnly#1289 |
| Image Edit - Face expression editor.json | UI | OK |  |  |  |
| Image Edit - Face swap (ReActor).json | UI | BROKEN |  | ReActorFaceSwap#33: `inswapper_128.onnx` |  |
| Image Edit - Hidden Faces (Hidden Faces).json | UI | BROKEN |  | ControlNetLoader#2: `control_v1p_sd15_qrcode_monster_v2.safetensors` |  |
| Image Edit - Inpaint (Inpainting).json | UI | BROKEN |  | ControlNetLoader#39: `control_v11p_sd15_inpaint.pth` |  |
| Image Edit - Inpaint and outpaint (Qwen Image ControlNet).json | UI | OK |  |  | muted/bypassed: CLIPLoader#174, UNETLoader#175, ControlNetLoader#177, ModelSamplingAuraFlow#180, LoraLoaderModelOnly#185, MaskPreview#207, PreviewImage#203, KSampler#190 |
| Image Edit - Inpaint with reference (Inpainting Reference Image).json | UI | BROKEN |  | UNETLoader#130: `flux1-fill-dev.safetensors`<br>StyleModelLoader#125: `flux1-redux-dev.safetensors` |  |
| Image Edit - Outpaint (Outpainting).json | UI | BROKEN |  | UNETLoader#31: `flux1FillDevFp8_v10.safetensors` |  |
| Image Edit - Put a person into a scene, 2 reference images (Qwen Image Edit).json | UI | OK |  |  |  |
| Train - Flux LoRA training, example v1.json | UI | OK |  |  | muted/bypassed: Display Any (rgthree)#73, UploadToHuggingFace#89 |
| Train - Flux LoRA training, example.json | UI | OK |  |  | muted/bypassed: Display Any (rgthree)#73, UploadToHuggingFace#89 |
| Upscale - ControlNet upscale (Flux, OpenArt).json | UI | BROKEN |  | LoraLoaderModelOnly#118: `Flux/Aesthetic_Amateur_Photo_V3.safetensors` (muted)<br>ControlNetLoader#117: `FLUX/flux.1-controlnet-Upscaler.safetensors`<br>LoraLoaderModelOnly#78: `Flux/Flux_Ultimator.safetensors` (muted) | muted/bypassed: LoraLoaderModelOnly#118, LoraLoaderModelOnly#78 |
| Upscale - Creative upscale with ControlNet (SDXL, OpenArt).json | UI | BROKEN |  | LoraLoader#117: `more_details.safetensors` (muted)<br>LoraLoader#118: `SDXLrender_v2.0.safetensors` (muted)<br>ControlNetLoader#99: `control_v11f1e_sd15_tile.bin` | muted/bypassed: LoraLoader#117, LoraLoader#118 |
| Upscale - Image to 2000px with face detailer (DreamShaper 8).json | UI | OK |  |  |  |
| Upscale - Quick 4x upscale (upscale model).json | UI | OK |  |  |  |
| Upscale - Quick upscale (Upscaling).json | UI | OK |  |  |  |
| Upscale - Tiled upscale (Ultimate SD Upscale).json | UI | OK |  |  |  |
| Upscale - Upscale (SD 3.5, OpenArt).json | UI | BROKEN |  | TripleCLIPLoader#365: `clip_g.safetensors`<br>CheckpointLoaderSimple#366: `base-fp8_sd3.5-fp8.safetensors` |  |
| Upscale - Upscale with automatic captions (Flux, Florence 2, OpenArt).json | UI | OK |  |  |  |
| Video - Character spin (Image2Image Character Spin).json | UI | BROKEN |  | UNETLoader#37: `Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors`<br>LoraLoaderModelOnly#58: `rotate_20_epochs.safetensors` |  |
| Video - First and last frame to video (Wan 2.2 14B Fun Inpaint).json | UI | BROKEN |  | UNETLoader#101: `wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors`<br>LoraLoaderModelOnly#116: `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`<br>LoraLoaderModelOnly#117: `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`<br>UNETLoader#138: `wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors` (muted)<br>UNETLoader#139: `wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors` (muted)<br>UNETLoader#102: `wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors` | muted/bypassed: CLIPLoader#136, VAELoader#137, UNETLoader#138, UNETLoader#139, LoadImage#140, LoadImage#147, WanFunInpaintToVideo#148, VAEDecode#151 |
| Video - Image and voice to talking video (Wan 2.2 S2V 14B).json | UI | OK |  |  | muted/bypassed: CLIPLoader#147, VAEDecode#148, CLIPTextEncode#149, VAELoader#150, AudioEncoderLoader#151, KSampler#152, WanSoundImageToVideo#153, ModelSamplingSD3#154 |
| Video - Image to video (MiniMax H3).json | UI | OK |  |  |  |
| Video - Image to video (Wan Image2Video).json | UI | BROKEN |  | UNETLoader#37: `wan2.1_i2v_720p_14B_fp16.safetensors` |  |
| Video - Image to video with camera motion (Wan 2.1 Fun Camera 1.3B).json | UI | OK |  |  | muted/bypassed: SaveAnimatedWEBP#60 |
| Video - Reference image and motion video to video (Wan 2.2 5B Fun Control).json | UI | OK |  |  | muted/bypassed: Canny#68, PreviewImage#69 |
| Video - Style transfer (Dancing Noodles).json | UI | BROKEN |  | ControlNetLoaderAdvanced#112: `control_v1p_sd15_qrcode_monster.safetensors`<br>ControlNetLoaderAdvanced#208: `control_v11p_sd15_lineart.pth`<br>ADE_AnimateDiffLoRALoader#220: `aidma-RUN-Motion_Lora.safetensors` | muted/bypassed: UpscaleModelLoader#150, ImageScale#153, VHS_VideoCombine#152, ImageUpscaleWithModel#151 |
| Video - Text to video (LTX Video).json | UI | OK |  |  |  |
| Video - Text to video (MiniMax H3).json | UI | OK |  |  |  |
| Video - Text to video (Wan 2.2 14B).json | UI | OK |  |  | muted/bypassed: ModelSamplingSD3#94, UNETLoader#102, ModelSamplingSD3#93, CLIPTextEncode#91, VAEDecode#97, SaveVideo#98, KSamplerAdvanced#96, KSamplerAdvanced#95 |
| Video - Text to video v2 (LTX Video).json | UI | OK |  |  |  |
| Video - Up to 6 reference images to video (MiniMax H3).json | UI | OK |  |  | muted/bypassed: LoadImage#139, LoadImage#141, LoadImage#142, LoadImage#143, LoadImage#144 |
| Video - Video to video (Hunyuan Video2Video).json | UI | BROKEN |  | UpscaleModelLoader#107: `RealESRGAN_x2.pth` (muted)<br>HyVideoLoraSelect#97: `Seb_HunyuanVideo.safetensors` (muted)<br>HyVideoModelLoader#1: `hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors` | muted/bypassed: ImageScale#106, ImageScale#108, JWIntegerMul#104, ImageListToBatch+#118, ImageResizeKJ#117, Int Literal#101, DF_Get_image_size#102, ImpactImageBatchToImageList#115 |
| video_minimax_h3_r2v.json | UI | OK |  |  | muted/bypassed: LoadImage#139, LoadImage#150 |
| 3D - HyperSD with Blender (HyperSD Blender).json | API | BROKEN |  | CheckpointLoaderSimple#162: `Hyper-SDXL-1step-Unet-Comfyui.fp16.safetensors`<br>ControlNetLoader#176: `sai_xl_depth_128lora.safetensors` |  |
| 3D - Image to 3D model (Hunyuan 3D).json | API | OK |  |  |  |
| 3D - Image to 3D model (Hunyuan3D 2.1).json | API | BROKEN |  |  | ImageOnlyCheckpointLoader#19:1: `hunyuan_3d_v2.1.safetensors` is on disk at ['checkpoints/3D Modelling/hunyuan_3d_v2.1.safetensors'] but not offered by this loader |
| 3D - Image to 3D model, multiview (Hunyuan3D 2 MV).json | API | OK |  |  |  |
| Audio - Text to song (ACE-Step).json | API | OK |  |  |  |
| Image - Character sheet v3 (Flux, Mickmumpitz).json | API | OK |  |  |  |
| Image - Character sheet v5 (Flux, Mickmumpitz).json | API | OK |  |  |  |
| Image - Consistent character (Flux).json | API | OK |  |  |  |
| Image - Consistent character creator v3.6 (Flux Kontext, Mickmumpitz).json | API | OK |  |  |  |
| Image - ControlNet Depth (ControlNet Depth).json | API | BROKEN |  | ControlNetLoader#7: `control-lora-depth-rank256.safetensors` |  |
| Image - Edge guided text to image (Qwen Image ControlNet).json | API | OK |  |  |  |
| Image - Funny Ultraman style pictures (Flux LoRA, OpenArt).json | API | OK |  |  |  |
| Image - Image to image (Img2Img).json | API | OK |  |  |  |
| Image - Image variations with a text prompt (SDXL Revision).json | API | OK |  |  |  |
| Image - Multi ControlNet (ControlNet).json | API | OK |  |  |  |
| Image - Qwen_Image_2512_360Degree_lora.json | API | OK |  |  |  |
| Image - Sketch to image (Sketch to Image).json | API | OK |  |  |  |
| Image - Text and reference to image (Flux 2).json | API | BROKEN |  | CLIPLoader#38: `mistral_3_small_flux2_bf16.safetensors` | UNETLoader#12: `flux1-dev-fp8.safetensors` is on disk at ['checkpoints/flux1-dev-fp8.safetensors'] but not offered by this loader |
| Image - Text to image (Chroma Radiance).json | API | OK |  |  |  |
| Image - Text to image (Juggernaut XL).json | API | OK |  |  |  |
| Image - Text to image (SD checkpoint).json | API | OK |  |  |  |
| Image - Text to image (SDXL Default).json | API | OK |  |  |  |
| Image - Text to image + 4x upscale (SD 1.5) v2.json | API | OK |  |  |  |
| Image - Text to image + 4x upscale (SD 1.5).json | API | OK |  |  |  |
| Image - Text to image with 2 reference images (Flux Dev fp8).json | API | OK |  |  |  |
| Image - Text to image with LoRAs (Using LoRAs).json | API | OK |  |  |  |
| Image - Text to image with a reference image (Flux Dev fp8).json | API | OK |  |  |  |
| Image - Text to image with a reference image + upscale (SD 1.5, USO).json | API | OK |  |  |  |
| Image - Text to image with reference images + upscale (Flux Kontext).json | API | OK |  |  |  |
| Image - Text to image with several LoRAs (SD checkpoint).json | API | OK |  |  |  |
| Image - Text to image with style presets (RealVis XL Lightning).json | API | OK |  |  |  |
| Image - Text to image, minimal (DreamShaper 8).json | API | OK |  |  |  |
| Image Edit - Character sheet from a photo (Qwen Image Edit).json | API | OK |  |  |  |
| Image Edit - Combine 2 images (Merging 2 Images).json | API | OK |  |  |  |
| Image Edit - Combine several images into one (Qwen Image Edit).json | API | OK |  |  |  |
| Image Edit - Face expression editor.json | API | OK |  |  |  |
| Image Edit - Face swap (ReActor).json | API | OK |  |  |  |
| Image Edit - Hidden Faces (Hidden Faces).json | API | BROKEN |  | ControlNetLoader#2: `control_v1p_sd15_qrcode_monster_v2.safetensors` |  |
| Image Edit - Inpaint (Inpainting).json | API | BROKEN |  | ControlNetLoader#39: `control_v11p_sd15_inpaint.pth` |  |
| Image Edit - Inpaint and outpaint (Qwen Image ControlNet).json | API | OK |  |  |  |
| Image Edit - Inpaint with reference (Inpainting Reference Image).json | API | BROKEN |  | StyleModelLoader#125: `flux1-redux-dev.safetensors`<br>UNETLoader#130: `flux1-fill-dev.safetensors` |  |
| Image Edit - Outpaint (Outpainting).json | API | BROKEN |  | UNETLoader#31: `flux1FillDevFp8_v10.safetensors` |  |
| Image Edit - Put a person into a scene, 2 reference images (Qwen Image Edit).json | API | OK |  |  |  |
| Train - Flux LoRA training, example v1.json | API | OK |  |  |  |
| Train - Flux LoRA training, example.json | API | OK |  |  |  |
| Upscale - ControlNet upscale (Flux, OpenArt).json | API | BROKEN |  | ControlNetLoader#117: `FLUX/flux.1-controlnet-Upscaler.safetensors` |  |
| Upscale - Creative upscale with ControlNet (SDXL, OpenArt).json | API | BROKEN |  | ControlNetLoader#99: `control_v11f1e_sd15_tile.bin` |  |
| Upscale - Image to 2000px with face detailer (DreamShaper 8).json | API | OK |  |  |  |
| Upscale - Quick 4x upscale (upscale model).json | API | OK |  |  |  |
| Upscale - Quick upscale (Upscaling).json | API | OK |  |  |  |
| Upscale - Tiled upscale (Ultimate SD Upscale).json | API | OK |  |  |  |
| Upscale - Upscale (SD 3.5, OpenArt).json | API | BROKEN |  | TripleCLIPLoader#365: `clip_g.safetensors`<br>CheckpointLoaderSimple#366: `base-fp8_sd3.5-fp8.safetensors` |  |
| Upscale - Upscale with automatic captions (Flux, Florence 2, OpenArt).json | API | OK |  |  |  |
| Video - Character spin (Image2Image Character Spin).json | API | BROKEN |  | UNETLoader#37: `Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors`<br>LoraLoaderModelOnly#58: `rotate_20_epochs.safetensors` |  |
| Video - First and last frame to video (Wan 2.2 14B Fun Inpaint).json | API | BROKEN |  | UNETLoader#101: `wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors`<br>LoraLoaderModelOnly#116: `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`<br>LoraLoaderModelOnly#117: `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`<br>UNETLoader#102: `wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors` |  |
| Video - Image and voice to talking video (Wan 2.2 S2V 14B).json | API | OK |  |  |  |
| Video - Image to video (MiniMax H3).json | API | OK |  |  |  |
| Video - Image to video (Wan Image2Video).json | API | BROKEN |  | UNETLoader#37: `wan2.1_i2v_720p_14B_fp16.safetensors` |  |
| Video - Image to video with camera motion (Wan 2.1 Fun Camera 1.3B).json | API | OK |  |  |  |
| Video - Reference image and motion video to video (Wan 2.2 5B Fun Control).json | API | OK |  |  |  |
| Video - Style transfer (Dancing Noodles).json | API | BROKEN |  | ControlNetLoaderAdvanced#112: `control_v1p_sd15_qrcode_monster.safetensors`<br>ControlNetLoaderAdvanced#208: `control_v11p_sd15_lineart.pth`<br>ADE_AnimateDiffLoRALoader#220: `aidma-RUN-Motion_Lora.safetensors` |  |
| Video - Text to video (LTX Video).json | API | OK |  |  |  |
| Video - Text to video (MiniMax H3).json | API | OK |  |  |  |
| Video - Text to video (Wan 2.2 14B).json | API | OK |  |  |  |
| Video - Text to video v2 (LTX Video).json | API | OK |  |  |  |
| Video - Up to 6 reference images to video (MiniMax H3).json | API | OK |  |  |  |
| Video - Video to video (Hunyuan Video2Video).json | API | BROKEN |  | HyVideoModelLoader#1: `hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors` |  |
| video_minimax_h3_r2v.json | API | OK |  |  |  |

## Totals

OK: 103  BROKEN: 33  total: 136

## Distinct missing nodes


## Distinct missing models

- `Alien_God_sdxl_1.safetensors` (loader: LoraLoader)
- `FLUX/flux.1-controlnet-Upscaler.safetensors` (loader: ControlNetLoader)
- `Flux/Aesthetic_Amateur_Photo_V3.safetensors` (loader: LoraLoaderModelOnly)
- `Flux/Flux_Ultimator.safetensors` (loader: LoraLoaderModelOnly)
- `Flux/aesthetic_anime_v1s.safetensors` (loader: LoraLoaderModelOnly)
- `Hyper-SDXL-1step-Unet-Comfyui.fp16.safetensors` (loader: CheckpointLoaderSimple)
- `RealESRGAN_x2.pth` (loader: UpscaleModelLoader)
- `SDXLrender_v2.0.safetensors` (loader: LoraLoader)
- `Seb_HunyuanVideo.safetensors` (loader: HyVideoLoraSelect)
- `Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors` (loader: UNETLoader)
- `aidma-RUN-Motion_Lora.safetensors` (loader: ADE_AnimateDiffLoRALoader)
- `base-fp8_sd3.5-fp8.safetensors` (loader: CheckpointLoaderSimple)
- `clip_g.safetensors` (loader: TripleCLIPLoader)
- `control-lora-depth-rank256.safetensors` (loader: ControlNetLoader)
- `control_v11f1e_sd15_tile.bin` (loader: ControlNetLoader)
- `control_v11p_sd15_inpaint.pth` (loader: ControlNetLoader)
- `control_v11p_sd15_lineart.pth` (loader: ControlNetLoaderAdvanced)
- `control_v1p_sd15_qrcode_monster.safetensors` (loader: ControlNetLoaderAdvanced)
- `control_v1p_sd15_qrcode_monster_v2.safetensors` (loader: ControlNetLoader)
- `flux1-fill-dev.safetensors` (loader: UNETLoader)
- `flux1-redux-dev.safetensors` (loader: StyleModelLoader)
- `flux1FillDevFp8_v10.safetensors` (loader: UNETLoader)
- `hunyuan3d-dit-v2-0-fp16.safetensors` (loader: Hy3DModelLoader)
- `hunyuan_video_720_cfgdistill_fp8_e4m3fn.safetensors` (loader: HyVideoModelLoader)
- `inswapper_128.onnx` (loader: ReActorFaceSwap)
- `mistral_3_small_flux2_bf16.safetensors` (loader: CLIPLoader)
- `more_details.safetensors` (loader: LoraLoader)
- `qwen/qwen-boreal-general-discrete-low-rank.safetensors` (loader: LoraLoaderModelOnly)
- `rotate_20_epochs.safetensors` (loader: LoraLoaderModelOnly)
- `sai_xl_depth_128lora.safetensors` (loader: ControlNetLoader)
- `wan2.1_i2v_720p_14B_fp16.safetensors` (loader: UNETLoader)
- `wan2.2_fun_inpaint_high_noise_14B_fp8_scaled.safetensors` (loader: UNETLoader)
- `wan2.2_fun_inpaint_low_noise_14B_fp8_scaled.safetensors` (loader: UNETLoader)
- `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` (loader: LoraLoaderModelOnly)
- `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` (loader: LoraLoaderModelOnly)

## On disk but not offered by the loader (wrong folder/name)

- `flux1-dev-fp8.safetensors` -> [('UNETLoader', ('checkpoints/flux1-dev-fp8.safetensors',))]
- `hunyuan_3d_v2.1.safetensors` -> [('ImageOnlyCheckpointLoader', ('checkpoints/3D Modelling/hunyuan_3d_v2.1.safetensors',))]

## Pinokio references

none found in workflow files
---

# Final fix (2026-11-10)

Everything above is the audit of the untouched state (re-generated from `workflows_backup_20261110`, a full copy taken before any edit). User rule: repoint to an equivalent on-disk model, otherwise move the workflow out.

## Repointed (UI file and API twin edited, widget filename only)

| Workflow | Node | Old | New |
|---|---|---|---|
| Image to 3D model (Hunyuan3D 2.1) (API twin only; UI already correct) | ImageOnlyCheckpointLoader#19:1 ckpt_name | `hunyuan_3d_v2.1.safetensors` | `3D Modelling\hunyuan_3d_v2.1.safetensors` |
| Upscale - ControlNet upscale (Flux, OpenArt) (UI + API) | ControlNetLoader#117 | `FLUX\flux.1-controlnet-Upscaler.safetensors` | `FLUX.1\flux_shakker_labs_union_pro-fp8_e4m3fn.safetensors` |

Caveat on the second: the graph has no SetUnionControlNetType node, so the union controlnet runs without an explicit tile/upscale mode; quality may differ from the original Upscaler controlnet. Its two missing LoRAs (Aesthetic_Amateur_Photo_V3, Flux_Ultimator) are muted nodes and were left alone.

## Moved to `workflows_broken\` (UI + `API_FORMAT\` twin, 16 workflows, nothing deleted)

See `workflows_broken\README.txt` (lists the exact missing models). Moved: HyperSD Blender (1-step unet, SDXL depth lora), Hunyuan 3D (v2.0 dit; only multiview turbo on disk), ControlNet Depth, Flux 2 (mistral text encoder), Face swap ReActor (inswapper_128.onnx), Hidden Faces, Inpaint (SD1.5 controlnets), Inpaint with reference (Flux Fill + Redux), Outpaint (Flux Fill), Creative upscale SDXL (SD1.5 tile controlnet), Upscale SD 3.5, Character spin (Wan I2V 14B + rotate lora), Wan 2.2 Fun Inpaint (fun inpaint unets + i2v lightx2v loras), Wan Image2Video (i2v 720p), Style transfer Dancing Noodles (controlnets + AnimateDiff lora), Hunyuan Video2Video (HunyuanVideo model).

## Final counts

Before: 68 workflows x 2 files = 136 files, 103 OK / 33 broken. After: 52 workflows x 2 = 104 files, 104 OK / 0 broken (re-audit). Repointed 2 workflows, moved 16, untouched OK 50. App `/api/tool/workflows`: 104 listed, 80 runnable before; 82 listed, 67 runnable after (its isRunnable only reflects graph structure, e.g. multiple output nodes, not missing models; the lower ratio is just the structural warnings on the remaining files, unchanged). POST `/api/tool/remake-api` returned `EISDIR` (the API_FORMAT subfolder is read as a file); not needed, the list refreshed by itself.
