/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for renderer/services/audio/wavEncoder.ts.
 * whisper-server only accepts WAV, so the RIFF header this produces has to be
 * byte-exact — a wrong field silently yields garbage transcriptions.
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { WHISPER_SAMPLE_RATE, encodeWav, mixToMono } from '@/renderer/services/audio/wavEncoder';

const ascii = (view: DataView, offset: number, length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');

describe('encodeWav', () => {
  it('writes a 44-byte RIFF/WAVE header describing 16-bit mono PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0]);
    const view = new DataView(encodeWav(samples, WHISPER_SAMPLE_RATE));

    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');

    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(WHISPER_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(WHISPER_SAMPLE_RATE * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it('sizes the buffer and the RIFF/data lengths from the sample count', () => {
    const samples = new Float32Array(100);
    const buffer = encodeWav(samples, 16_000);
    const view = new DataView(buffer);

    expect(buffer.byteLength).toBe(44 + 200);
    expect(view.getUint32(4, true)).toBe(36 + 200);
    expect(view.getUint32(40, true)).toBe(200);
  });

  it('clamps out-of-range samples instead of wrapping them', () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2, 1, -1, 0]), 16_000));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(0);
  });

  it('produces an empty data chunk for an empty recording', () => {
    const buffer = encodeWav(new Float32Array(0), 16_000);
    expect(buffer.byteLength).toBe(44);
    expect(new DataView(buffer).getUint32(40, true)).toBe(0);
  });
});

describe('mixToMono', () => {
  it('returns the single channel untouched', () => {
    const channel = new Float32Array([0.1, 0.2]);
    expect(mixToMono([channel], 2)).toBe(channel);
  });

  it('averages multiple channels', () => {
    const left = new Float32Array([1, 0]);
    const right = new Float32Array([0, 1]);
    expect(Array.from(mixToMono([left, right], 2))).toEqual([0.5, 0.5]);
  });
});
