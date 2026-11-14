import { BaseTelegramClient, MemoryStorage, WebCryptoProvider, WebPlatform } from '@mtcute/web';
import { UserFacingError } from '../../domain/errors.ts';
import { createTelegramDiagnostics } from './diagnostics.ts';
import type { WebCryptoProviderOptions } from '@mtcute/web';

const traceCall = createTelegramDiagnostics();

export const makeCrypto = (wasmInput?: WebCryptoProviderOptions['wasmInput']) =>
  new WebCryptoProvider({
    wasmInput,
  });

class Client extends BaseTelegramClient {
  override call: BaseTelegramClient['call'] = (method, options) =>
    traceCall(method, () =>
      super.call(method, { timeout: 30000, floodSleepThreshold: 0, maxRetryCount: 0, ...options }),
    );
}
class LocalPlatform extends WebPlatform {
  // Do not let the SDK probe localStorage for log settings; file:// may deny it.
  override getDefaultLogLevel() {
    return 0;
  }
}

export function createClient(
  apiId: number,
  apiHash: string,
  { qrLogin = false }: { qrLogin?: boolean } = {},
) {
  if (!globalThis.crypto?.subtle)
    throw new UserFacingError('WebCrypto is unavailable. Open the HTTPS site in a modern browser.');
  return new Client({
    apiId,
    apiHash,
    storage: new MemoryStorage(),
    platform: new LocalPlatform(),
    crypto: makeCrypto(),
    logLevel: 0,
    // QR authorization needs updateLoginToken; keep chat update processing off.
    disableUpdates: !qrLogin,
    updates: false,
    initConnectionOptions: {
      deviceModel: 'Poll Intersections',
      appVersion: '0.2',
      systemVersion: 'Browser',
    },
  });
}
