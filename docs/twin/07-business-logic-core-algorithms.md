# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Agent Lifecycle

`WorkerTaskManager` caches `IAgentManager` instances per conversation, creates new managers through `IAgentFactory`, kills replaced managers to prevent orphan child processes, and periodically kills idle ACP/Aion CLI agents.

```ts
private killIdleCliAgents(): void {
  void this.getIdleTimeoutMs().then((timeoutMs) => {
    const now = Date.now();
    const idleTasks = this.taskList.filter(
      (item) =>
        (item.task.type === 'acp' || item.task.type === 'aionrs') &&
        item.task.status === 'finished' &&
        !cronBusyGuard.isProcessing(item.id) &&
        now - item.task.lastActivityAt > timeoutMs
    );
    for (const item of idleTasks) this.kill(item.id, 'idle_timeout');
  });
}
```

Model client selection uses `ClientFactory.createRotatingClient`. New API URLs are normalized so OpenAI gets `/v1` while Gemini/Anthropic get root URLs.

Team model resolution checks saved Gemini defaults, enabled providers, Google OAuth credentials, and fallback models. Aion CLI requires an enabled provider.

Extension routing, upload workspace validation, and channel plugin initialization are key business rules that protect runtime boundaries.

## Managed GGUF Runtime Algorithm

`startManagedLlamaServer` implements the local model lifecycle:

1. Resolve and validate the requested model path against configured roots.
2. Resolve `llama-server` from candidates.
3. Stop any existing managed server.
4. Allocate a free loopback port.
5. Build llama.cpp arguments.
6. Spawn the process with an enhanced shell environment.
7. Poll `/health` until HTTP 200 or timeout.
8. Return `{ port, baseUrl, pid, alias, modelPath }`.

The spawned arguments are deterministic:

```ts
const args = ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '--alias', alias, '-ngl', String(gpuLayers), '-c', String(contextSize)];
if (reasoning) args.push('--reasoning', reasoning);
```

The reasoning flag is important for models that otherwise stream thinking tags
or spend answer budget on hidden reasoning. Known working local options on
Antman's machine set `reasoning: 'off'` for Qwen3.5 4B/9B, Gemma 12B, and
DeepSeek R1 Distill Qwen 14B.

## Areas for Review

- Convert task cache from array to `Map` and expose task diagnostics.
- Make team model fallback decisions visible to users.
- Add exhaustive tests for provider normalization and model resolution.
- Persist managed local runtime history so the UI can explain which model last failed and why.
