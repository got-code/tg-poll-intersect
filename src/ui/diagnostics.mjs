import { UserFacingError } from '../domain/errors.mjs';
import { makeCrypto, explainError } from '../infrastructure/telegram.mjs';
import { $, status } from './dom.mjs';

export function bindDiagnostics() {
  $('diagnose').addEventListener('click', async () => {
    $('diagnose').disabled = true;
    status('Checking…', false, 'diagnostic');
    try {
      if (!globalThis.crypto?.subtle || !globalThis.WebAssembly || !globalThis.WebSocket) throw new UserFacingError('WebCrypto, WebAssembly or WebSocket is unavailable in this browser.');
      const crypto = makeCrypto();
      await crypto.initialize();
      const digest = crypto.sha256(new TextEncoder().encode('poll-intersections'));
      if (digest.length !== 32) throw new UserFacingError('The bundled cryptography check failed.');
      await new Promise((resolve, reject) => {
        const socket = new WebSocket('wss://venus.web.telegram.org/apiws', 'binary');
        const timer = setTimeout(() => { socket.close(); reject(new UserFacingError('WebCrypto and WASM work. Telegram did not respond within 10 seconds. Check your network.')); }, 10000);
        socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(); };
        socket.onerror = () => { clearTimeout(timer); reject(new UserFacingError('WebCrypto and WASM work. Telegram is unreachable from this browser or network.')); };
      });
      status(`WebCrypto ✓ · bundled WASM ✓ · Telegram WebSocket ✓\nPage protocol: ${location.protocol} · Sign-in and poll access have not been checked.`, false, 'diagnostic');
    } catch (error) { status(explainError(error), true, 'diagnostic'); }
    finally { $('diagnose').disabled = false; }
  });
}
