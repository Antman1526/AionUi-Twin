import { describe, expect, it, beforeEach } from 'vitest';
import {
  getGhostModeStatus,
  isAllowedLocalUrl,
  resetGhostModeState,
  setGhostMode,
} from '../../../packages/desktop/src/process/services/security/ghostModeService';

describe('GhostModeService', () => {
  beforeEach(() => {
    resetGhostModeState();
  });

  it('permits loopback and local network protocols while blocking internet traffic', () => {
    // Allowed
    expect(isAllowedLocalUrl('http://localhost:11434/api/generate')).toBe(true);
    expect(isAllowedLocalUrl('http://127.0.0.1:8080/v1/chat')).toBe(true);
    expect(isAllowedLocalUrl('http://[::1]:8080/v1/chat')).toBe(true);
    expect(isAllowedLocalUrl('file:///Applications/WE.app/index.html')).toBe(true);
    expect(isAllowedLocalUrl('data:text/plain;base64,SGVsbG8=')).toBe(true);
    expect(isAllowedLocalUrl('we://quickbar')).toBe(true);

    // Blocked
    expect(isAllowedLocalUrl('https://api.openai.com/v1/models')).toBe(false);
    expect(isAllowedLocalUrl('https://huggingface.co/api/models')).toBe(false);
    expect(isAllowedLocalUrl('https://telemetry.segment.io/v1')).toBe(false);
    expect(isAllowedLocalUrl('https://raw.githubusercontent.com/test')).toBe(false);
  });

  it('updates ghost mode state toggle correctly', () => {
    expect(getGhostModeStatus().enabled).toBe(false);

    const activeState = setGhostMode(true);
    expect(activeState.enabled).toBe(true);
    expect(getGhostModeStatus().enabled).toBe(true);

    const disabledState = setGhostMode(false);
    expect(disabledState.enabled).toBe(false);
    expect(getGhostModeStatus().enabled).toBe(false);
  });
});
