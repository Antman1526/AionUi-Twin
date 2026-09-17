/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

let mockPrivateMode: boolean | undefined = false;

vi.mock('swr', () => ({
  default: () => ({ data: mockPrivateMode, mutate: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }),
}));

vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    privacy: { getPrivateMode: { invoke: vi.fn().mockResolvedValue(false) } },
    team: { get: { invoke: vi.fn() } },
    conversation: { get: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';

const renderTitlebar = () =>
  render(
    <MemoryRouter>
      <Titlebar workspaceAvailable={false} />
    </MemoryRouter>
  );

describe('Titlebar private mode pill', () => {
  it('does not render the Private pill when Private Mode is off', () => {
    mockPrivateMode = false;
    renderTitlebar();
    expect(screen.queryByText('common.privateModeLabel')).not.toBeInTheDocument();
  });

  it('renders the Private pill when the config hook reports Private Mode is on', () => {
    mockPrivateMode = true;
    renderTitlebar();
    expect(screen.getByText('common.privateModeLabel')).toBeInTheDocument();
  });
});
