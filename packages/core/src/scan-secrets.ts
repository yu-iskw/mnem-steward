type SecretScanResult = { readonly hit: false } | { readonly hit: true; readonly rule: string };

const SLACK_WEBHOOK_MARKER = 'hooks.slack.com/services/';
const SLACK_WEBHOOK_TAIL = /^T[\dA-Z]+\/B[\dA-Z]+\/[\w-]+/u;

const SECRET_RULES: readonly { readonly rule: string; readonly pattern: RegExp }[] = [
  { rule: 'pem-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { rule: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { rule: 'aws-secret-key', pattern: /\b(?:aws_)?secret_access_key\b/iu },
  { rule: 'github-pat', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/u },
  { rule: 'github-fine-grained-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u },
  { rule: 'slack-token', pattern: /\bxox[baprs]-[\w-]{10,}\b/u },
  { rule: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { rule: 'google-api-key', pattern: /\bAIza[\w-]{35}\b/u },
  { rule: 'gcp-oauth-token', pattern: /\bya29\.[\w.-]{20,}\b/u },
  { rule: 'bearer-token', pattern: /\bBearer\s+[\w./+=-]{16,}\b/u },
  { rule: 'jwt-bearer', pattern: /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+\b/u },
  { rule: 'service-account-json', pattern: /"type"\s*:\s*"service_account"/u },
  { rule: 'uri-password', pattern: /\b[a-z][\d+.a-z-]*:\/\/[^/\s:]+:[^@\s]+@/iu },
];

function hasSlackWebhook(text: string): boolean {
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(SLACK_WEBHOOK_MARKER, from);
    if (idx < 0) {
      return false;
    }
    if (SLACK_WEBHOOK_TAIL.test(text.slice(idx + SLACK_WEBHOOK_MARKER.length))) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

export function scanSecrets(text: string): SecretScanResult {
  for (const candidate of SECRET_RULES) {
    if (candidate.pattern.test(text)) {
      return { hit: true, rule: candidate.rule };
    }
  }
  if (hasSlackWebhook(text)) {
    return { hit: true, rule: 'slack-webhook' };
  }
  return { hit: false };
}
