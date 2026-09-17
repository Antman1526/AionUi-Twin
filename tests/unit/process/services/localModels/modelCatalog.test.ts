import { describe, expect, it } from 'vitest';
import { catalogDownloadUrl, findCatalogModel, MODEL_CATALOG } from '@process/services/localModels/modelCatalog';

describe('MODEL_CATALOG', () => {
  it('has unique ids', () => {
    const ids = MODEL_CATALOG.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique file names, so downloads never collide in one directory', () => {
    const files = MODEL_CATALOG.map((model) => model.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('pins a 64-character lower-case hex SHA-256 and a positive size for every entry', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.sha256, model.id).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes, model.id).toBeGreaterThan(0);
      expect(model.file.endsWith('.gguf'), model.id).toBe(true);
    }
  });

  it('marks exactly one entry as the recommended default', () => {
    expect(MODEL_CATALOG.filter((model) => model.recommendedDefault)).toHaveLength(1);
  });

  it('offers at least one embedding model', () => {
    expect(MODEL_CATALOG.some((model) => model.kind === 'embedding')).toBe(true);
  });

  it('builds Hugging Face resolve URLs', () => {
    const model = findCatalogModel('qwen3-4b-q4km');
    expect(model).toBeDefined();
    expect(catalogDownloadUrl(model!)).toBe(
      'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf'
    );
  });

  it('returns undefined for an unknown id', () => {
    expect(findCatalogModel('not-a-model')).toBeUndefined();
  });
});
