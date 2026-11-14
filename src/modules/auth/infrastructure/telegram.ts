import { sendCode, signIn, signInQr, checkPassword, getMe, logOut } from '@mtcute/web/methods.js';
import { withTelegramErrors } from '../../../infrastructure/telegram/errors.ts';
import { UserFacingError } from '../../../application/errors.ts';
import type { BaseTelegramClient } from '@mtcute/web';
import type { AuthGateway, AuthUser, CodeDelivery, QrCallbacks } from '../application/contracts.ts';

export { createClient } from '../../../infrastructure/telegram/client.ts';

const user = ({ displayName }: AuthUser): AuthUser => ({ displayName });

function delivery(type: string): CodeDelivery {
  const deliveries: readonly CodeDelivery[] = [
    'app',
    'sms',
    'call',
    'email',
    'sms_word',
    'sms_phrase',
  ];
  const value = deliveries.find((value) => value === type);
  if (!value) throw new UserFacingError('Telegram requested an unsupported sign-in method.');
  return value;
}

export const auth = {
  sendCode: (client: BaseTelegramClient, phone: string) =>
    withTelegramErrors(async () => {
      const sent = await sendCode(client, { phone });
      return 'phoneCodeHash' in sent
        ? { codeToken: sent.phoneCodeHash, delivery: delivery(sent.type) }
        : user(sent);
    }),
  signIn: (client: BaseTelegramClient, phone: string, phoneCodeHash: string, phoneCode: string) =>
    withTelegramErrors(async () => user(await signIn(client, { phone, phoneCodeHash, phoneCode }))),
  qr: (client: BaseTelegramClient, options: QrCallbacks) =>
    withTelegramErrors(async () => user(await signInQr(client, options))),
  password: (client: BaseTelegramClient, password: string) =>
    withTelegramErrors(async () => user(await checkPassword(client, password))),
  logout: (client: BaseTelegramClient) =>
    withTelegramErrors(async () => {
      await logOut(client);
    }),
  me: (client: BaseTelegramClient) => withTelegramErrors(async () => user(await getMe(client))),
} satisfies AuthGateway<BaseTelegramClient>;
