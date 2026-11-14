// Only deliberately safe messages may be displayed to the user.
export class UserFacingError extends Error {}

export class PasswordRequiredError extends Error {}

export interface ServiceFailure {
  service: string;
  kind:
    | 'rpc'
    | 'timeout'
    | 'network'
    | 'peer-not-found'
    | 'message-not-found'
    | 'invalid-peer'
    | 'security-check'
    | 'unexpected-response'
    | 'unexpected';
  rpcCode?: string;
  status?: number;
  retryAfterSeconds?: number;
  timeoutMs?: number;
}

export class ServiceError extends UserFacingError {
  readonly details: Readonly<ServiceFailure>;

  constructor(message: string, details: Readonly<ServiceFailure>) {
    super(message);
    this.details = details;
  }
}

export const REQUEST_FAILED_MESSAGE = 'The request failed for an unknown reason. Try again.';
