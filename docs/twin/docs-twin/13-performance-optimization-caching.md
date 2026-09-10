# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Current Optimizations

SQLite WAL + busy timeout, indexed conversation/message/team queries, in-memory worker task cache, idle agent killing, Vite vendor chunks, package exclusions, disk-backed large uploads, 30 MB STT cap, extension static asset caching, and disabled native rebuilds during packaging.

The task cache is currently an array. `Map<string, IAgentManager>` would reduce lookup/removal complexity. Message search can likely improve with SQLite FTS5. Renderer bundles should be checked with a bundle analyzer because markdown/editor/chart dependencies are large.

## Local Model Performance Notes

Local GGUF performance is dominated by model size, quantization, context length,
GPU offload, and thinking/reasoning behavior. The current defaults favor usability
over minimal resource use:

- context window defaults to `16384`;
- GPU layers default to `99`;
- readiness timeout defaults to `180000ms`;
- known thinking-heavy models should use `reasoning: off` for concise answers.

For older Macs or RAM-constrained machines, lower `contextSize` first, then
reduce `gpuLayers`. For quality-sensitive prompts, prefer `Qwen2.5-14B` or
larger confirmed models when the machine can hold them comfortably.

## Areas for Review

- Add task cache metrics and convert array to Map.
- Benchmark FTS5 message search.
- Add lazy loading for route-level renderer pages.
- Track team session memory/CPU over long remote-channel runs.
- Add local model token/sec and load-time telemetry to guide default recommendations.
