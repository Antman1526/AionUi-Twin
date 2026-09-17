import { describe, expect, it } from 'vitest';
import { findWhisperCatalogModel, WHISPER_MODEL_CATALOG } from '@process/services/whisper/whisperModelCatalog';

describe('WHISPER_MODEL_CATALOG', () => {
  it('has unique ids', () => {
    const ids = WHISPER_MODEL_CATALOG.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique file names, so downloads never collide in one directory', () => {
    const files = WHISPER_MODEL_CATALOG.map((model) => model.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('pins a 64-character lower-case hex SHA-256 and a positive size for every entry', () => {
    for (const model of WHISPER_MODEL_CATALOG) {
      expect(model.sha256, model.id).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes, model.id).toBeGreaterThan(0);
      expect(model.file.endsWith('.bin'), model.id).toBe(true);
      expect(model.url.endsWith(model.file), model.id).toBe(true);
    }
  });

  it('finds a catalog entry by id', () => {
    const model = findWhisperCatalogModel('base-q5_1');
    expect(model).toBeDefined();
    expect(model?.file).toBe('ggml-base-q5_1.bin');
  });

  it('returns undefined for an unknown id', () => {
    expect(findWhisperCatalogModel('not-a-model')).toBeUndefined();
  });
});
