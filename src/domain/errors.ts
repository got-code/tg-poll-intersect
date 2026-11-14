// Only deliberately user-facing messages may cross the Telegram error boundary.
export class UserFacingError extends Error {}

export function errorDetails(error: unknown) {
  const record = typeof error === 'object' && error !== null ? error : {};
  return {
    text: 'text' in record && typeof record.text === 'string' ? record.text : '',
    message: 'message' in record && typeof record.message === 'string' ? record.message : '',
    name: 'name' in record && typeof record.name === 'string' ? record.name : '',
    code: 'code' in record && typeof record.code === 'number' ? record.code : undefined,
  };
}
