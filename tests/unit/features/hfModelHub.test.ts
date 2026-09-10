import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  getHfModelDetails,
  searchHfModels,
} from '../../../packages/desktop/src/process/services/hfHub/hfModelHubService';

describe('HfModelHubService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches Hugging Face models for GGUF and MLX and formats output', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'test-org/test-model-GGUF',
          author: 'test-org',
          downloads: 12500,
          likes: 340,
          tags: ['gguf', 'text-generation'],
          description: 'A test GGUF model',
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const results = await searchHfModels({ query: 'test', type: 'gguf', limit: 5 });
    expect(mockFetch).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('test-org/test-model-GGUF');
    expect(results[0].downloads).toBe(12500);
    expect(results[0].modelType).toBe('gguf');
  });

  it('fetches model details, resolves file sizes from tree, and extracts quantizations', async () => {
    const mockModelMeta = {
      id: 'mlx-community/Qwen2.5-7B-4bit',
      author: 'mlx-community',
      downloads: 45000,
      likes: 900,
      tags: ['mlx', 'text-generation'],
      siblings: [{ rfilename: 'config.json' }, { rfilename: 'model.safetensors' }, { rfilename: 'tokenizer.json' }],
    };

    const mockTree = [
      { path: 'config.json', size: 1024 },
      { path: 'model.safetensors', size: 4200000000 },
      { path: 'tokenizer.json', size: 2048000 },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/tree/main')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockTree,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockModelMeta,
        });
      })
    );

    const details = await getHfModelDetails('mlx-community/Qwen2.5-7B-4bit');
    expect(details.id).toBe('mlx-community/Qwen2.5-7B-4bit');
    expect(details.modelType).toBe('mlx');
    expect(details.files).toHaveLength(3);

    const safetensors = details.files.find((f) => f.name === 'model.safetensors');
    expect(safetensors).toBeDefined();
    expect(safetensors?.sizeBytes).toBe(4200000000);
  });
});
