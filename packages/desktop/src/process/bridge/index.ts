/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initThemeBridge } from './themeBridge';
import { initLocalModelBridge, stopLocalModelServer } from './localModelBridge';
import { initSystemMetricsBridge } from './systemMetricsBridge';
import { initHfHubBridge } from './hfHubBridge';
import { initGhostModeBridge } from './ghostModeBridge';
import { initQuickBarBridge } from './quickBarBridge';
import { initSemanticSearchBridge } from './semanticSearchBridge';
import { initSleepReviewBridge } from './sleepReviewBridge';
import { initLocalModelMetricsBridge } from './localModelMetricsBridge';
import { initArenaBridge } from './arenaBridge';
import { initSpeechToTextBridge, stopLocalWhisperServer } from './speechToTextBridge';

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initThemeBridge();
  initLocalModelBridge();
  initSystemMetricsBridge();
  initHfHubBridge();
  initGhostModeBridge();
  initQuickBarBridge();
  initSpeechToTextBridge();
  initLocalModelMetricsBridge();
  initArenaBridge();
  initSemanticSearchBridge();
  initSleepReviewBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initLocalModelBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initThemeBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
  initSystemMetricsBridge,
  initHfHubBridge,
  initGhostModeBridge,
  initQuickBarBridge,
  initSpeechToTextBridge,
  initLocalModelMetricsBridge,
  initArenaBridge,
  initSemanticSearchBridge,
  initSleepReviewBridge,
  stopLocalModelServer,
  stopLocalWhisperServer,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
