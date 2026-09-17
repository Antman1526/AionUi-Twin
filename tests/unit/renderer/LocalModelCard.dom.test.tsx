import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, icon, ...props }: React.ComponentProps<'button'> & { icon?: React.ReactNode }) => (
    <button {...props}>{children ?? icon}</button>
  ),
  Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('@icon-park/react', () => ({
  Computer: () => <span>Computer</span>,
  Link: () => <span>Link</span>,
}));

const openSettings = vi.fn();
vi.mock('@/renderer/components/settings/SettingsModal/useSettingsModal', () => ({
  default: () => ({ openSettings, settingsModal: null, closeSettings: vi.fn(), visible: false }),
}));

const openExternalUrl = vi.fn();
vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

const configGet = vi.fn(async () => undefined);
vi.mock('@/common/config/storage', () => ({
  ConfigStorage: { get: (key: string) => configGet(key as never), set: vi.fn(async () => undefined) },
}));

const getStatus = vi.fn();
const listModels = vi.fn();
const getExecutableStatus = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: {
    localModel: {
      getStatus: { invoke: () => getStatus() },
      listModels: { invoke: () => listModels() },
      getExecutableStatus: { invoke: () => getExecutableStatus() },
      runtimeChanged: { on: () => () => undefined },
    },
    mode: { getModelConfig: { invoke: vi.fn(async () => []) } },
  },
}));

import { SWRConfig } from 'swr';
import LocalModelCard from '@/renderer/pages/guid/components/cards/LocalModelCard';

/** Fresh SWR cache per render so one test's fetch result never leaks into the next. */
const renderCard = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LocalModelCard />
    </SWRConfig>
  );

const notRunning = { success: true, data: { running: false } };

beforeEach(() => {
  vi.clearAllMocks();
  configGet.mockResolvedValue(undefined);
});

describe('LocalModelCard', () => {
  it('shows the running model with a "use in chat" action', async () => {
    getStatus.mockResolvedValue({
      success: true,
      data: { running: true, name: 'Qwen3-4B-Q4_K_M', baseUrl: 'http://127.0.0.1:1/v1', modelPath: '/m/a.gguf' },
    });
    listModels.mockResolvedValue({ success: true, data: { roots: [], models: [] } });
    getExecutableStatus.mockResolvedValue({ success: true, data: { found: true, platform: 'darwin' } });

    renderCard();

    expect(await screen.findByText('Qwen3-4B-Q4_K_M')).toBeInTheDocument();
    expect(screen.getByText('guid.localModels.useInChat')).toBeInTheDocument();
  });

  it('shows "in use" instead of the action when the managed provider is already selected', async () => {
    getStatus.mockResolvedValue({
      success: true,
      data: { running: true, name: 'Qwen3-4B-Q4_K_M', baseUrl: 'http://127.0.0.1:1/v1', modelPath: '/m/a.gguf' },
    });
    listModels.mockResolvedValue({ success: true, data: { roots: [], models: [] } });
    getExecutableStatus.mockResolvedValue({ success: true, data: { found: true, platform: 'darwin' } });
    configGet.mockResolvedValue({ id: 'local-llama-cpp-123', useModel: 'Qwen3-4B-Q4_K_M' } as never);

    renderCard();

    expect(await screen.findByText('guid.localModels.inUse')).toBeInTheDocument();
    expect(screen.queryByText('guid.localModels.useInChat')).not.toBeInTheDocument();
  });

  it('counts discovered models and offers to open settings when none is running', async () => {
    getStatus.mockResolvedValue(notRunning);
    listModels.mockResolvedValue({
      success: true,
      data: {
        roots: [],
        models: [
          { path: '/m/a.gguf', name: 'a', kind: 'llm', format: 'gguf', suggestedRuntime: 'llama.cpp', sizeBytes: 1 },
          { path: '/m/b.gguf', name: 'b', kind: 'llm', format: 'gguf', suggestedRuntime: 'llama.cpp', sizeBytes: 1 },
          { path: '/m/c.bin', name: 'c', kind: 'stt', format: 'bin', suggestedRuntime: 'whisper.cpp', sizeBytes: 1 },
        ],
      },
    });
    getExecutableStatus.mockResolvedValue({ success: true, data: { found: true, platform: 'darwin' } });

    renderCard();

    expect(await screen.findByText('guid.localModels.found:2')).toBeInTheDocument();
    screen.getByText('guid.localModels.load').click();
    expect(openSettings).toHaveBeenCalledWith('model');
  });

  it('offers install guidance when llama-server is missing and no model is on disk', async () => {
    getStatus.mockResolvedValue(notRunning);
    listModels.mockResolvedValue({ success: true, data: { roots: [], models: [] } });
    getExecutableStatus.mockResolvedValue({ success: true, data: { found: false, platform: 'win32' } });

    renderCard();

    expect(await screen.findByText('guid.localModels.installTitle')).toBeInTheDocument();
    screen.getByText('guid.localModels.install').click();
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/ggml-org/llama.cpp/releases');
  });

  it('renders nothing when there is no local model and llama-server is installed', async () => {
    getStatus.mockResolvedValue(notRunning);
    listModels.mockResolvedValue({ success: true, data: { roots: [], models: [] } });
    getExecutableStatus.mockResolvedValue({ success: true, data: { found: true, platform: 'linux' } });

    const { container } = renderCard();

    await vi.waitFor(() => expect(getExecutableStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
