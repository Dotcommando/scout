interface IRuntimeConfiguration {
  readonly apiBaseUrl: string;
}

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

export function readApiBaseUrl(): string {
  const runtimeValue = Object.entries(window)
    .find(([key]) => key === '__SCOUT_ADMIN_RUNTIME_CONFIGURATION__')?.[1];

  if (runtimeValue === null || typeof runtimeValue !== 'object' || Array.isArray(runtimeValue)) {
    return DEFAULT_API_BASE_URL;
  }

  return isRuntimeConfiguration(runtimeValue)
    ? runtimeValue.apiBaseUrl
    : DEFAULT_API_BASE_URL;
}

function isRuntimeConfiguration(value: unknown): value is IRuntimeConfiguration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const apiBaseUrl = Object.entries(value)
    .find(([key]) => key === 'apiBaseUrl')?.[1];

  return typeof apiBaseUrl === 'string' && apiBaseUrl.trim().length > 0;
}
