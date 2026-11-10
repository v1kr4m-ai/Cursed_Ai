# Graph Report - trainTool  (2026-11-03)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 177 nodes · 396 edges · 12 communities (7 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f09272ab`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- speech_common.py
- routes.ts
- speech.ts
- mobile.ts
- jobs.ts
- sources.ts
- train_llm.py
- caption_images.py
- describe_image.py
- extract_docx.py
- extract_pdf.py
- tts_speak.py

## God Nodes (most connected - your core abstractions)
1. `registerTrainTool()` - 33 edges
2. `registerSpeechTool()` - 27 edges
3. `registerMobileTool()` - 16 edges
4. `say()` - 13 edges
5. `startProcess()` - 12 edges
6. `startTask()` - 10 edges
7. `exists()` - 8 edges
8. `listDirs()` - 8 edges
9. `load_audio()` - 8 edges
10. `JobState` - 7 edges

## Surprising Connections (you probably didn't know these)
- `registerTrainTool()` --indirect_call--> `exists()`  [INFERRED]
  routes.ts → paths.ts
- `registerTrainTool()` --calls--> `JobState`  [EXTRACTED]
  routes.ts → jobs.ts
- `registerSpeechTool()` --calls--> `JobState`  [EXTRACTED]
  speech.ts → jobs.ts
- `registerTrainTool()` --calls--> `isRunning()`  [EXTRACTED]
  routes.ts → jobs.ts
- `registerSpeechTool()` --calls--> `isRunning()`  [EXTRACTED]
  speech.ts → jobs.ts

## Import Cycles
- None detected.

## Communities (12 total, 5 thin omitted)

### Community 0 - "speech_common.py"
Cohesion: 0.10
Nodes (30): main(), Convert a fine-tuned Whisper model (the folder made by train_whisper.py) to the…, main(), Turn a clips folder (audio + .txt) into the layout the XTTS trainer reads:…, _edit_distance(), error_rate(), load_audio(), normalize() (+22 more)

### Community 1 - "routes.ts"
Cohesion: 0.12
Nodes (28): buildLlmArgs(), buildLoraArgs(), cleanLlm(), cleanLora(), LlmConfig, LoraConfig, loraDatasetToml(), writeLoraToml() (+20 more)

### Community 2 - "speech.ts"
Cohesion: 0.15
Nodes (29): bad(), clipsIn(), KINDS, probe(), readJson(), readText(), registerSpeechTool(), runStep() (+21 more)

### Community 3 - "mobile.ts"
Cohesion: 0.16
Nodes (25): isRunning(), JobState, bad(), MobileOptions, paramsMillions(), readJson(), registerMobileTool(), buildMobileArgs() (+17 more)

### Community 4 - "jobs.ts"
Cohesion: 0.33
Nodes (13): addLine(), everyone, finish(), fresh(), Job, JobKind, jobs, pushState() (+5 more)

### Community 5 - "sources.ts"
Cohesion: 0.23
Nodes (13): buildPairPrompt(), describeWithOllama(), extractJsonArray(), finishPairs(), htmlToText(), looksLikeFiller(), META, Pair (+5 more)

### Community 6 - "train_llm.py"
Cohesion: 0.60
Nodes (4): load_alpaca_jsonl(), main(), Offline LLM QLoRA fine-tune, driven entirely by CLI args from the Electron app.…, to_text()

## Knowledge Gaps
- **15 isolated node(s):** `LoraConfig`, `LlmConfig`, `Job`, `jobs`, `everyone` (+10 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `registerTrainTool()` connect `routes.ts` to `mobile.ts`, `jobs.ts`, `sources.ts`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `registerSpeechTool()` connect `speech.ts` to `routes.ts`, `mobile.ts`, `jobs.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `startProcess()` connect `jobs.ts` to `routes.ts`, `speech.ts`, `mobile.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `LoraConfig`, `LlmConfig`, `Job` to the rest of the system?**
  _15 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `speech_common.py` be split into smaller, more focused modules?**
  _Cohesion score 0.09672830725462304 - nodes in this community are weakly interconnected._
- **Should `routes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12298387096774194 - nodes in this community are weakly interconnected._