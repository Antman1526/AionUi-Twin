export const LOCAL_OLLAMA_OPENAI_BASE_URL = 'http://localhost:11434/v1';
export const DOCKER_MODEL_RUNNER_OPENAI_BASE_URL = 'http://localhost:12434/engines/v1';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const isLocalModelProviderBaseUrl = (baseUrl?: string): boolean => {
  if (!baseUrl) return false;

  try {
    const parsed = new URL(baseUrl);
    return LOCAL_HOSTS.has(parsed.hostname) && (parsed.port === '11434' || parsed.port === '12434');
  } catch {
    return false;
  }
};

export const getLocalProviderApiKey = (baseUrl?: string): string | undefined => {
  if (!baseUrl) return undefined;

  try {
    const parsed = new URL(baseUrl);
    if (!LOCAL_HOSTS.has(parsed.hostname)) return undefined;
    if (parsed.port === '11434') return 'ollama';
    if (parsed.port === '12434') return 'not-needed';
    return undefined;
  } catch {
    return undefined;
  }
};
