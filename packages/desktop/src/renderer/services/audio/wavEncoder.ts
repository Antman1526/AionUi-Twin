/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WAV encoding for the offline whisper.cpp backend.
 *
 * `whisper-server` only accepts WAV, while MediaRecorder hands us webm/ogg, so
 * the local provider decodes the recording and re-encodes it as 16 kHz mono
 * 16-bit PCM — the sample rate whisper models are trained on. The cloud
 * providers keep sending their original blob untouched.
 */

/** Sample rate expected by whisper.cpp. */
export const WHISPER_SAMPLE_RATE = 16_000;

const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encode mono float samples (nominally -1..1) as a 16-bit PCM RIFF/WAVE buffer.
 * Out-of-range samples are clamped rather than wrapped, so a hot microphone
 * produces clipping instead of loud noise artefacts.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  const byteRate = sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric scaling keeps -1 at exactly -32768 and +1 at +32767.
    view.setInt16(WAV_HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
}

/** Average all channels of a decoded buffer down to one. */
export function mixToMono(channels: Float32Array[], frameCount: number): Float32Array {
  if (channels.length === 1) {
    return channels[0];
  }
  const mono = new Float32Array(frameCount);
  for (const channel of channels) {
    for (let i = 0; i < frameCount; i += 1) {
      mono[i] += channel[i] / channels.length;
    }
  }
  return mono;
}

type AudioContextCtor = typeof AudioContext;
type OfflineAudioContextCtor = typeof OfflineAudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const ctor = (globalThis as { AudioContext?: AudioContextCtor }).AudioContext;
  if (!ctor) throw new Error('STT_AUDIO_UNSUPPORTED');
  return ctor;
}

function getOfflineAudioContextCtor(): OfflineAudioContextCtor {
  const ctor = (globalThis as { OfflineAudioContext?: OfflineAudioContextCtor }).OfflineAudioContext;
  if (!ctor) throw new Error('STT_AUDIO_UNSUPPORTED');
  return ctor;
}

/**
 * Decode a recorded blob and re-encode it as 16 kHz mono WAV.
 * Resampling is done by an `OfflineAudioContext` rendered at the target rate.
 */
export async function convertBlobToWav(blob: Blob, targetSampleRate = WHISPER_SAMPLE_RATE): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new (getAudioContextCtor())();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    void decodeContext.close();
  }

  const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate || 1));
  const offline = new (getOfflineAudioContextCtor())(1, frameCount, targetSampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    channels.push(rendered.getChannelData(channel));
  }
  const mono = mixToMono(channels, rendered.length);
  return new Blob([encodeWav(mono, targetSampleRate)], { type: 'audio/wav' });
}
