import { UserFacingError, errorDetails } from '../domain/errors.ts';

export function explainError(error: unknown) {
  const details = errorDetails(error);
  const code = details.text || details.message;
  const known = [
    ['POLL_VOTE_REQUIRED', 'Vote in each poll in Telegram first, then refresh the results.'],
    [
      'BROADCAST_FORBIDDEN',
      'Telegram does not expose voter lists in channels. Use polls in a group.',
    ],
    ['API_ID_INVALID', 'Check your API ID and API hash from my.telegram.org/apps.'],
    [
      'API_ID_PUBLISHED_FLOOD',
      'Telegram rejected these API keys. Use your own application’s keys.',
    ],
    ['PHONE_NUMBER_INVALID', 'Check the phone number, including the country code.'],
    ['PHONE_CODE_INVALID', 'Incorrect code. Check the code from Telegram.'],
    ['PHONE_CODE_EXPIRED', 'The code expired. Close the dialog and start signing in again.'],
    ['AUTH_TOKEN_EXPIRED', 'The QR code expired. Show a new QR code and scan it again.'],
    ['AUTH_TOKEN_INVALID', 'The QR code is no longer valid. Show a new QR code and scan it again.'],
    ['PASSWORD_HASH_INVALID', 'Incorrect two-step verification password.'],
    ['AUTH_RESTART', 'Telegram requires a fresh login. Close the dialog and try again.'],
    ['SESSION_REVOKED', 'The session was revoked. Sign out and sign in again.'],
    ['AUTH_KEY_UNREGISTERED', 'The login expired. Sign out and sign in again.'],
    ['CHANNEL_PRIVATE', 'This account does not have access to the group.'],
    ['MSG_ID_INVALID', 'The poll message was not found. Check the link.'],
    ['timed out', 'Telegram did not respond within 30 seconds. Check your connection and retry.'],
  ];
  for (const [match, text] of known)
    if (code.includes(match) || details.name.includes(match)) return text;
  if (/FLOOD|SLOWMODE/.test(code))
    return 'Telegram is limiting requests. Wait before trying again.';
  // Show local validation errors, but never dump a raw API payload or credentials.
  if (error instanceof UserFacingError) return error.message;
  return 'The request failed. Check your connection and poll access, then try again.';
}
