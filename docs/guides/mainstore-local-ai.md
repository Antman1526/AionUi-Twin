# MainStore Local AI Setup

AionUi can use local LLMs through OpenAI-compatible HTTP endpoints while the model files live on MainStore.

## Provider Presets

The model settings include two local presets:

| Provider                        | Base URL                            | API key                            |
| :------------------------------ | :---------------------------------- | :--------------------------------- |
| Ollama (MainStore)              | `http://localhost:11434/v1`         | Optional, defaults to `ollama`     |
| Docker Model Runner (MainStore) | `http://localhost:12434/engines/v1` | Optional, defaults to `not-needed` |

Docker documents `http://localhost:12434/engines/v1` as the OpenAI-compatible base URL for host processes when Docker Model Runner TCP access is enabled.

## MainStore Paths

The setup script expects this layout by default:

```text
MainStore/
  Development/AI-Models/ollama/models
  DockerDMR/models
  llm/hf-cache
  llm/llm_config.json
```

On macOS, the default MainStore root is `/Volumes/MainStore`.

On Windows 11, set the root explicitly if MainStore is not `D:\MainStore`:

```powershell
$env:AIONUI_MAINSTORE_PATH = "E:\MainStore"
```

## Check Configuration

```bash
npm run mainstore:check
```

For a custom root:

```bash
node scripts/mainstore-local-ai.mjs check --mainstore /Volumes/MainStore
```

On Windows 11:

```powershell
node scripts/mainstore-local-ai.mjs check --mainstore D:\MainStore
```

## Environment Variables

Print shell commands for Ollama, MLX/Hugging Face cache, and local API base URLs:

```bash
npm run mainstore:env
```

On Windows 11 this prints `setx` commands. On macOS and Linux it prints `export` commands.

## Docker Model Runner Storage

To point Docker Model Runner's model cache at MainStore:

```bash
npm run mainstore:link-docker-dmr
```

The script creates `~/.docker/models` as:

- a symlink on macOS/Linux
- a junction on Windows 11

If `~/.docker/models` already exists as a real directory, the script refuses to replace it unless you pass `--force`:

```bash
node scripts/mainstore-local-ai.mjs link-docker-dmr --force
```

With `--force`, the existing directory is renamed to a timestamped backup before the link is created.

## Runtime Requirements

- Ollama must be running for the Ollama preset.
- Docker Model Runner must be enabled with TCP host access for the Docker preset.
- Models must already exist in the relevant MainStore-backed model directory.
