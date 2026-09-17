/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WAV encoding for the offline whisper.cpp speech-to-text provider.
 *
 * `whisper-server` expects a 16kHz mono 16-bit PCM WAV file, but
 * `MediaRecorder` only produces compressed formats (webm/ogg/mp4). This module
 * decodes the recorded blob, resamples it to 16kHz mono, and encodes a plain
 * PCM WAV buffer — used for the `whisper-local` provider only; cloud providers
 * keep sending the original recorded blob.
 */

const WAV_SAMPLE_RATE = 16_000;
const WAV_BITS_PER_SAMPLE = 16;
const WAV_NUM_CHANNELS = 1;
const WAV_HEADER_BYTES = 44;

/**
 * Encode mono PCM samples (32-bit float, range [-1, 1]) into a 16-bit PCM WAV
 * `ArrayBuffer` with a standard 44-byte RIFF header. Out-of-range samples are
 * clipped rather than wrapped.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * (WAV_BITS_PER_SAMPLE / 8);
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  const byteRate = sampleRate * WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
  const blockAlign = WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size (PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, WAV_NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    const intSample = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

/** Mix an `AudioBuffer`'s channels down to a single mono `Float32Array`. */
function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  const length = audioBuffer.length;
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      mixed[i] += data[i] / audioBuffer.numberOfChannels;
    }
  }
  return mixed;
}

/**
 * Decode a recorded audio blob (webm/ogg/mp4/...) and resample it to 16kHz
 * mono, returning a WAV `Blob` ready to send to whisper-server.
 */
export async function convertBlobToWav(blob: Blob): Promise<Blob> {
  const AudioContextCtor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('STT_WAV_ENCODE_UNSUPPORTED');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void decodeContext.close().catch((): void => undefined);
  }

  const OfflineAudioContextCtor =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;

  let monoSamples: Float32Array;
  let sampleRate: number;
  if (OfflineAudioContextCtor) {
    const duration = decoded.duration;
    const frameCount = Math.max(1, Math.ceil(duration * WAV_SAMPLE_RATE));
    const offlineContext = new OfflineAudioContextCtor(1, frameCount, WAV_SAMPLE_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start(0);
    const rendered = await offlineContext.startRendering();
    monoSamples = mixToMono(rendered);
    sampleRate = rendered.sampleRate;
  } else {
    // Fallback: no resampling support, encode at the decoded sample rate.
    monoSamples = mixToMono(decoded);
    sampleRate = decoded.sampleRate;
  }

  const wavBuffer = encodeWav(monoSamples, sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
