import { GoogleAuth, Impersonated } from 'google-auth-library';

import type { AccessTokenProvider } from './config.js';
import type { AuthClient } from 'google-auth-library';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export type GoogleCredentialMode = 'env' | 'adc' | 'impersonate';

export type GoogleCredentialDescription = {
  readonly mode: GoogleCredentialMode;
  readonly targetPrincipal?: string;
};

export function formatGoogleCredentialDescription(
  description: GoogleCredentialDescription | undefined,
): string | undefined {
  if (description === undefined) {
    return undefined;
  }
  if (description.targetPrincipal === undefined) {
    return `google_credentials mode=${description.mode}`;
  }
  return `google_credentials mode=${description.mode} target=${description.targetPrincipal}`;
}

export type DescribedAccessTokenProvider = AccessTokenProvider & {
  describeCredentials(): GoogleCredentialDescription;
};

export type GoogleAccessTokenProviderConfig = {
  readonly mode: GoogleCredentialMode;
  readonly envToken?: string;
  readonly impersonateServiceAccount?: string;
  /** Test seam: supply the ADC/source AuthClient. */
  readonly getSourceClient?: () => Promise<AuthClient>;
  /** Test seam: build an Impersonated (or stub) client. */
  readonly createImpersonatedClient?: (input: {
    sourceClient: AuthClient;
    targetPrincipal: string;
    targetScopes: string[];
  }) => AuthClient;
};

/**
 * Resolve credential mode from env.
 * Unset mode: `env` when GOOGLE_ACCESS_TOKEN is set, otherwise `adc`.
 */
export function assertGoogleCredentialConfig(
  mode: GoogleCredentialMode,
  config: Pick<GoogleAccessTokenProviderConfig, 'envToken' | 'impersonateServiceAccount'>,
): void {
  switch (mode) {
    case 'env':
      if (config.envToken?.trim() === undefined || config.envToken.trim() === '') {
        throw new Error('GOOGLE_CREDENTIAL_MODE=env requires GOOGLE_ACCESS_TOKEN');
      }
      return;
    case 'adc':
      return;
    case 'impersonate':
      if (
        config.impersonateServiceAccount?.trim() === undefined ||
        config.impersonateServiceAccount.trim() === ''
      ) {
        throw new Error(
          'GOOGLE_CREDENTIAL_MODE=impersonate requires GOOGLE_IMPERSONATE_SERVICE_ACCOUNT',
        );
      }
      return;
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function resolveGoogleCredentialMode(env: {
  mode?: string;
  envToken?: string;
}): GoogleCredentialMode {
  const explicit = env.mode?.trim();
  if (explicit !== undefined && explicit !== '') {
    switch (explicit) {
      case 'env':
      case 'adc':
      case 'impersonate':
        return explicit;
      default:
        throw new Error(`Unsupported GOOGLE_CREDENTIAL_MODE: ${explicit}`);
    }
  }
  const token = env.envToken?.trim();
  if (token !== undefined && token !== '') {
    return 'env';
  }
  return 'adc';
}

/**
 * Downstream Google credential broker (MCP JWT is never used here).
 * Modes: env token, Application Default Credentials, or SA impersonation.
 */
export function createGoogleAccessTokenProvider(
  config: GoogleAccessTokenProviderConfig,
): DescribedAccessTokenProvider {
  assertGoogleCredentialConfig(config.mode, config);
  switch (config.mode) {
    case 'env':
      return envProvider(config.envToken);
    case 'adc':
      return authClientProvider('adc', undefined, () => resolveSourceClient(config));
    case 'impersonate':
      return impersonateProvider(config);
    default: {
      const exhaustive: never = config.mode;
      return exhaustive;
    }
  }
}

/**
 * @deprecated Prefer {@link createGoogleAccessTokenProvider}. Kept for live tests
 * that pass a static env token (equivalent to mode `env`) or ADC when omitted.
 */
export function createAccessTokenProvider(input: { envToken?: string }): AccessTokenProvider {
  const fromEnv = input.envToken?.trim();
  if (fromEnv !== undefined && fromEnv !== '') {
    return createGoogleAccessTokenProvider({ mode: 'env', envToken: fromEnv });
  }
  return createGoogleAccessTokenProvider({ mode: 'adc' });
}

function envProvider(envToken: string | undefined): DescribedAccessTokenProvider {
  const token = envToken?.trim() ?? '';
  return {
    describeCredentials: () => ({ mode: 'env' }),
    getAccessToken(): Promise<string> {
      return Promise.resolve(token);
    },
  };
}

function authClientProvider(
  mode: GoogleCredentialMode,
  targetPrincipal: string | undefined,
  getClient: () => Promise<AuthClient>,
): DescribedAccessTokenProvider {
  let clientPromise: Promise<AuthClient> | undefined;
  return {
    describeCredentials: () =>
      targetPrincipal === undefined ? { mode } : { mode, targetPrincipal },
    async getAccessToken(): Promise<string> {
      clientPromise ??= getClient();
      const client = await clientPromise;
      const result = await client.getAccessToken();
      const token = typeof result === 'string' ? result : result.token;
      if (token === null || token === undefined || token.trim() === '') {
        throw new Error('Google Auth client returned an empty access token');
      }
      return token;
    },
  };
}

function impersonateProvider(
  config: GoogleAccessTokenProviderConfig,
): DescribedAccessTokenProvider {
  const target = config.impersonateServiceAccount?.trim() ?? '';
  const createImpersonated =
    config.createImpersonatedClient ??
    ((input: {
      sourceClient: AuthClient;
      targetPrincipal: string;
      targetScopes: string[];
    }): AuthClient =>
      new Impersonated({
        sourceClient: input.sourceClient,
        targetPrincipal: input.targetPrincipal,
        targetScopes: input.targetScopes,
      }));

  return authClientProvider('impersonate', target, async () => {
    const sourceClient = await resolveSourceClient(config);
    return createImpersonated({
      sourceClient,
      targetPrincipal: target,
      targetScopes: [CLOUD_PLATFORM_SCOPE],
    });
  });
}

async function resolveSourceClient(config: GoogleAccessTokenProviderConfig): Promise<AuthClient> {
  if (config.getSourceClient !== undefined) {
    return config.getSourceClient();
  }
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  return auth.getClient();
}
