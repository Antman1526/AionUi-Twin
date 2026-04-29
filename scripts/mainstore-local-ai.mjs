#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MAINSTORE_BY_PLATFORM = {
  darwin: '/Volumes/MainStore',
  linux: '/mnt/MainStore',
  win32: 'D:\\MainStore',
};

const usage = `Usage:
  node scripts/mainstore-local-ai.mjs check [--mainstore <path>]
  node scripts/mainstore-local-ai.mjs print-env [--mainstore <path>]
  node scripts/mainstore-local-ai.mjs link-docker-dmr [--mainstore <path>] [--force]

Environment:
  AIONUI_MAINSTORE_PATH  Override the MainStore root path.

Notes:
  - check never modifies files.
  - link-docker-dmr creates ~/.docker/models as a symlink on macOS/Linux or a junction on Windows.
  - without --force, an existing real ~/.docker/models directory is left untouched.
`;

const pathForPlatform = (platform) => (platform === 'win32' ? path.win32 : path.posix);

export function buildMainStorePlan({
  homeDir = os.homedir(),
  mainStorePath = process.env.AIONUI_MAINSTORE_PATH ||
    DEFAULT_MAINSTORE_BY_PLATFORM[process.platform] ||
    '/mnt/MainStore',
  platform = process.platform,
} = {}) {
  const pathApi = pathForPlatform(platform);
  const mainStore = pathApi.normalize(mainStorePath);
  const dockerHome = pathApi.join(homeDir, '.docker');

  return {
    platform,
    mainStorePath: mainStore,
    llmConfigPath: pathApi.join(mainStore, 'llm', 'llm_config.json'),
    env: {
      OLLAMA_MODELS: pathApi.join(mainStore, 'Development', 'AI-Models', 'ollama', 'models'),
      HF_HOME: pathApi.join(mainStore, 'llm', 'hf-cache'),
      DOCKER_MODEL_RUNNER_BASE_URL: 'http://localhost:12434/engines/v1',
      OLLAMA_OPENAI_BASE_URL: 'http://localhost:11434/v1',
    },
    dockerModelsLink: {
      source: pathApi.join(mainStore, 'DockerDMR', 'models'),
      target: pathApi.join(dockerHome, 'models'),
      type: platform === 'win32' ? 'junction' : 'dir',
    },
  };
}

function parseArgs(argv) {
  const args = { command: argv[2] || 'check', mainStorePath: undefined, force: false };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mainstore') {
      args.mainStorePath = argv[i + 1];
      i += 1;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--help' || arg === '-h') {
      args.command = 'help';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function exists(target) {
  return fs.existsSync(target);
}

function describePath(label, target) {
  console.log(`${label}: ${target} ${exists(target) ? '[found]' : '[missing]'}`);
}

function printCheck(plan) {
  describePath('MainStore', plan.mainStorePath);
  describePath('LLM config', plan.llmConfigPath);
  describePath('Ollama models', plan.env.OLLAMA_MODELS);
  describePath('HF cache', plan.env.HF_HOME);
  describePath('Docker DMR models', plan.dockerModelsLink.source);
  describePath('Docker models link target', plan.dockerModelsLink.target);
  console.log(`Ollama OpenAI base URL: ${plan.env.OLLAMA_OPENAI_BASE_URL}`);
  console.log(`Docker Model Runner OpenAI base URL: ${plan.env.DOCKER_MODEL_RUNNER_BASE_URL}`);
}

function printEnv(plan) {
  Object.entries(plan.env).forEach(([key, value]) => {
    if (plan.platform === 'win32') {
      console.log(`setx ${key} "${value}"`);
    } else {
      console.log(`export ${key}="${value}"`);
    }
  });
}

function linkDockerDmr(plan, { force = false } = {}) {
  const { source, target, type } = plan.dockerModelsLink;

  if (!exists(source)) {
    throw new Error(`Docker DMR source directory does not exist: ${source}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (exists(target)) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      fs.rmSync(target);
    } else if (force) {
      const backup = `${target}.backup-${Date.now()}`;
      fs.renameSync(target, backup);
      console.log(`Moved existing Docker models directory to ${backup}`);
    } else {
      throw new Error(`Refusing to replace existing Docker models path without --force: ${target}`);
    }
  }

  fs.symlinkSync(source, target, type);
  console.log(`Linked ${target} -> ${source}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    console.log(usage);
    return;
  }

  const plan = buildMainStorePlan({ mainStorePath: args.mainStorePath });

  switch (args.command) {
    case 'check':
      printCheck(plan);
      break;
    case 'print-env':
      printEnv(plan);
      break;
    case 'link-docker-dmr':
      linkDockerDmr(plan, { force: args.force });
      break;
    default:
      throw new Error(`Unknown command: ${args.command}\n\n${usage}`);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
