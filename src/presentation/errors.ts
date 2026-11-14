import { DomainError } from '../domain/errors.ts';
import { REQUEST_FAILED_MESSAGE, ServiceError, UserFacingError } from '../application/errors.ts';

export function explainError(error: unknown) {
  if (error instanceof ServiceError && error.details.rpcCode) {
    const { service, rpcCode, status } = error.details;
    return `${error.message}\n${service} error: ${rpcCode}${status === undefined ? '' : ` (RPC ${status})`}.`;
  }
  if (error instanceof UserFacingError || error instanceof DomainError) return error.message;
  return REQUEST_FAILED_MESSAGE;
}
