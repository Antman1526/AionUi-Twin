import { describe, expect, it } from 'vitest';
import { encodeWav } from '@/renderer/services/audio/wavEncoder';

/** Read a little-endian uint32 out of the encoded buffer. */
const readUint32 = (view: DataView, offset: number) => view.getUint32(offset, true);
const readUint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readString = (view: DataView, offset: number, length: number) => {
  let value = '';
  for (let i = 0; i < length; i++) value += String.fromCharCode(view.getUint8(offset + i));
  return value;
};

describe('encodeWav', () => {
  it('writes a standard 44-byte RIFF/WAVE header for 16kHz mono 16-bit PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWav(samples, 16_000);
    const view = new DataView(buffer);

    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(readString(view, 8, 4)).toBe('WAVE');
    expect(readString(view, 12, 4)).toBe('fmt ');
    expect(readString(view, 36, 4)).toBe('data');

    expect(readUint32(view, 16)).toBe(16); // fmt chunk size (PCM)
    expect(readUint16(view, 20)).toBe(1); // audio format: PCM
    expect(readUint16(view, 22)).toBe(1); // mono
    expect(readUint32(view, 24)).toBe(16_000); // sample rate
    expect(readUint16(view, 34)).toBe(16); // bits per sample

    const byteRate = 16_000 * 1 * (16 / 8);
    expect(readUint32(view, 28)).toBe(byteRate);
    expect(readUint16(view, 32)).toBe(2); // block align (1 channel * 16 bits / 8)
  });

  it('reports the correct overall and data chunk byte lengths', () => {
    const samples = new Float32Array(100).fill(0.1);
    const buffer = encodeWav(samples, 16_000);
    const view = new DataView(buffer);

    const dataBytes = samples.length * 2;
    expect(buffer.byteLength).toBe(44 + dataBytes);
    expect(readUint32(view, 4)).toBe(36 + dataBytes); // RIFF chunk size
    expect(readUint32(view, 40)).toBe(dataBytes); // data chunk size
  });

  it('encodes full-scale samples without overflowing into the wrong sign', () => {
    const buffer = encodeWav(new Float32Array([1, -1]), 16_000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('clips out-of-range samples instead of wrapping', () => {
    const buffer = encodeWav(new Float32Array([2, -2]), 16_000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('round-trips silence as zero samples', () => {
    const buffer = encodeWav(new Float32Array([0, 0, 0]), 16_000);
    const view = new DataView(buffer);
    for (let i = 0; i < 3; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(0);
    }
  });
});
