/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Human-readable byte size using binary units (1024-based). */
export const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`;
};
