export type GoogleMemoryConfig = {
  readonly project: string;
  readonly location: string;
  readonly reasoningEngineId: string;
};

export type AccessTokenProvider = {
  getAccessToken(): Promise<string>;
};

export type HttpClient = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
};

export function isGoogleMemoryConfigured(
  env: Record<string, string | undefined>,
): env is Record<string, string | undefined> & {
  GOOGLE_CLOUD_PROJECT: string;
  GOOGLE_CLOUD_LOCATION: string;
  GOOGLE_REASONING_ENGINE_ID: string;
} {
  return (
    nonEmpty(env['GOOGLE_CLOUD_PROJECT']) &&
    nonEmpty(env['GOOGLE_CLOUD_LOCATION']) &&
    nonEmpty(env['GOOGLE_REASONING_ENGINE_ID'])
  );
}

export function googleMemoryConfigFromEnv(env: Record<string, string | undefined>): GoogleMemoryConfig {
  const project = env['GOOGLE_CLOUD_PROJECT'];
  const location = env['GOOGLE_CLOUD_LOCATION'];
  const reasoningEngineId = env['GOOGLE_REASONING_ENGINE_ID'];
  if (!nonEmpty(project) || !nonEmpty(location) || !nonEmpty(reasoningEngineId)) {
    throw new Error('Google Memory Bank env is incomplete');
  }
  return { project, location, reasoningEngineId };
}

export function memoryBankParent(config: GoogleMemoryConfig): string {
  return `projects/${config.project}/locations/${config.location}/reasoningEngines/${config.reasoningEngineId}`;
}

export function memoryBankBaseUrl(location: string): string {
  if (location === 'global') {
    return 'https://aiplatform.googleapis.com';
  }
  if (location === 'us' || location === 'eu') {
    return `https://aiplatform.${location}.rep.googleapis.com`;
  }
  return `https://${location}-aiplatform.googleapis.com`;
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
