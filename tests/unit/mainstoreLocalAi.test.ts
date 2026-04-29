import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(path.resolve(process.cwd(), 'scripts/mainstore-local-ai.mjs')).href;

describe('MainStore local AI setup planner', () => {
  it('builds macOS paths for MainStore LLM and Docker Model Runner storage', async () => {
    const { buildMainStorePlan } = await import(scriptUrl);

    const plan = buildMainStorePlan({
      homeDir: '/Users/alex',
      mainStorePath: '/Volumes/MainStore',
      platform: 'darwin',
    });

    expect(plan.env.OLLAMA_MODELS).toBe('/Volumes/MainStore/Development/AI-Models/ollama/models');
    expect(plan.env.HF_HOME).toBe('/Volumes/MainStore/llm/hf-cache');
    expect(plan.dockerModelsLink).toEqual({
      source: '/Volumes/MainStore/DockerDMR/models',
      target: '/Users/alex/.docker/models',
      type: 'dir',
    });
  });

  it('builds Windows 11 junction paths when a MainStore drive is provided', async () => {
    const { buildMainStorePlan } = await import(scriptUrl);

    const plan = buildMainStorePlan({
      homeDir: 'C:\\Users\\Alex',
      mainStorePath: 'D:\\MainStore',
      platform: 'win32',
    });

    expect(plan.env.OLLAMA_MODELS).toBe('D:\\MainStore\\Development\\AI-Models\\ollama\\models');
    expect(plan.env.HF_HOME).toBe('D:\\MainStore\\llm\\hf-cache');
    expect(plan.dockerModelsLink).toEqual({
      source: 'D:\\MainStore\\DockerDMR\\models',
      target: 'C:\\Users\\Alex\\.docker\\models',
      type: 'junction',
    });
  });
});
