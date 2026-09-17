import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${Object.values(options).join(',')}` : key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Progress: ({ percent }: { percent: number }) => <span data-testid='progress'>{percent}</span>,
}));

const useInferenceStats = vi.fn();
vi.mock('@renderer/pages/conversation/components/InferenceHud/useInferenceStats', () => ({
  useInferenceStats: (params: { conversationId?: string; enabled: boolean }) => useInferenceStats(params) as unknown,
}));

import InferenceHud from '@renderer/pages/conversation/components/InferenceHud';

const STATS = {
  tokensPerSecond: 42.35,
  approximate: false,
  usedTokens: 1024,
  contextSize: 4096,
  rssBytes: 2 * 1024 ** 3,
  streaming: true,
};

describe('InferenceHud', () => {
  it('renders nothing for a cloud provider even when figures are available', () => {
    useInferenceStats.mockReturnValue(STATS);
    const { container } = render(<InferenceHud providerId='openai-1' conversationId='c1' />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the conversation carries no provider id', () => {
    useInferenceStats.mockReturnValue(STATS);
    const { container } = render(<InferenceHud conversationId='c1' />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves the stats hook disabled for a cloud provider', () => {
    useInferenceStats.mockReturnValue(STATS);
    render(<InferenceHud providerId='openai-1' conversationId='c1' />);
    expect(useInferenceStats).toHaveBeenCalledWith({ conversationId: 'c1', enabled: false });
  });

  it('renders speed, context and memory pills for the managed local provider', () => {
    useInferenceStats.mockReturnValue(STATS);
    render(<InferenceHud providerId='local-llama-cpp-qwen' conversationId='c1' />);

    expect(screen.getByText('conversation.hud.tokensPerSecond:42.4')).toBeInTheDocument();
    expect(screen.getByTestId('progress')).toHaveTextContent('25');
    expect(screen.getByText('2.0 GB')).toBeInTheDocument();
  });

  it('marks an estimated rate with the approximate key', () => {
    useInferenceStats.mockReturnValue({ ...STATS, approximate: true });
    render(<InferenceHud providerId='local-llama-cpp-qwen' conversationId='c1' />);
    expect(screen.getByText('conversation.hud.tokensPerSecondApprox:42.4')).toBeInTheDocument();
  });

  it('renders nothing for a local provider while no figure could be read', () => {
    useInferenceStats.mockReturnValue({
      tokensPerSecond: null,
      approximate: false,
      usedTokens: null,
      contextSize: null,
      rssBytes: null,
      streaming: false,
    });
    const { container } = render(<InferenceHud providerId='local-llama-cpp-qwen' conversationId='c1' />);
    expect(container).toBeEmptyDOMElement();
  });
});
