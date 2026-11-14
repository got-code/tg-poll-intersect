import { lazyTelegram } from '../../../infrastructure/telegram/loader.ts';
import type { AuthGateway } from '../application/contracts.ts';
import type { createClient as createSdkClient } from './telegram.ts';

const load = lazyTelegram(() => import('./telegram.ts'));
type Client = ReturnType<typeof createSdkClient>;

export const preloadAuth = () => load().then(() => {});

export async function createClient(...args: Parameters<typeof createSdkClient>) {
  return (await load()).createClient(...args);
}

export const auth: AuthGateway<Client> = {
  sendCode: async (...args) => (await load()).auth.sendCode(...args),
  signIn: async (...args) => (await load()).auth.signIn(...args),
  qr: async (...args) => (await load()).auth.qr(...args),
  password: async (...args) => (await load()).auth.password(...args),
  me: async (...args) => (await load()).auth.me(...args),
  logout: async (...args) => (await load()).auth.logout(...args),
};
