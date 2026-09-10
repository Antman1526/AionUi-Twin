import { describe, expect, it, vi } from 'vitest';
import { soundEffects } from '../../../packages/desktop/src/renderer/utils/audio/soundEffects';

describe('SoundEffects', () => {
  it('handles playback gracefully in non-audio environments without throwing', () => {
    expect(() => soundEffects.playClick()).not.toThrow();
    expect(() => soundEffects.playComplete()).not.toThrow();
    expect(() => soundEffects.playShieldLock(true)).not.toThrow();
    expect(() => soundEffects.playShieldLock(false)).not.toThrow();
  });

  it('interacts with AudioContext when available in browser', () => {
    const mockOsc = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };

    function MockAudioContext() {
      return {
        currentTime: 10,
        state: 'running',
        createOscillator: () => mockOsc,
        createGain: () => mockGain,
        destination: {},
      };
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('window', { AudioContext: MockAudioContext });

    expect(() => soundEffects.playClick()).not.toThrow();
    expect(() => soundEffects.playShieldLock(true)).not.toThrow();
  });
});
