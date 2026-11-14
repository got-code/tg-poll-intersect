import { sendCode, signIn, signInQr, checkPassword, getMe, logOut } from '@mtcute/web/methods.js';
import type { BaseTelegramClient } from '@mtcute/web';
import type { AuthGateway, QrCallbacks } from '../../application/auth-contracts.ts';

export const auth = {
  sendCode: (client: BaseTelegramClient, phone: string) => sendCode(client, { phone }),
  signIn: (client: BaseTelegramClient, phone: string, phoneCodeHash: string, phoneCode: string) =>
    signIn(client, { phone, phoneCodeHash, phoneCode }),
  qr: (client: BaseTelegramClient, options: QrCallbacks) => signInQr(client, options),
  password: (client: BaseTelegramClient, password: string) => checkPassword(client, password),
  logout: (client: BaseTelegramClient) => logOut(client),
  me: (client: BaseTelegramClient) => getMe(client),
} satisfies AuthGateway<BaseTelegramClient>;
