import { UserFacingError } from '../domain/errors.mjs';
// Only this encrypted envelope is persisted. Passwords and derived keys stay in memory.
export const SESSION_KEY = 'poll-intersections.session.v1';
const ITERATIONS = 600000;
const aad = new TextEncoder().encode('poll-intersections.session.v1');
const storageError = () => new UserFacingError('The browser did not allow saving the login. You can continue without saving.');

function validatePayload(data) {
  if (!data || !Number.isInteger(data.apiId) || data.apiId < 1 || data.apiId > 2147483647 ||
      typeof data.apiHash !== 'string' || !/^[a-f0-9]{32}$/i.test(data.apiHash) ||
      typeof data.session !== 'string' || data.session.length < 10 || data.session.length > 20000) {
    throw new UserFacingError('The saved session is damaged. Forget the saved login and sign in again.');
  }
  return { apiId: data.apiId, apiHash: data.apiHash, session: data.session };
}
function encode(bytes) { return btoa(String.fromCharCode(...bytes)); }
function decode(value, size) {
  if (typeof value !== 'string' || value.length > 40000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (size != null && bytes.length !== size) throw new Error();
  return bytes;
}
function readEnvelope(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 50000) throw new Error();
    const record = JSON.parse(raw);
    if (record.v !== 1 || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== ITERATIONS || record.cipher !== 'AES-GCM') throw new Error();
    const salt = decode(record.salt, 16), iv = decode(record.iv, 12), ciphertext = decode(record.ciphertext);
    if (ciphertext.length < 16) throw new Error();
    return { record, salt, iv, ciphertext };
  } catch { throw new UserFacingError('The saved login is damaged or uses an unsupported format. Forget it and sign in again.'); }
}
async function deriveKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new UserFacingError('Saving a login requires WebCrypto. Open the HTTPS site in a modern browser.');
  const bytes = new TextEncoder().encode(password);
  let material;
  try { material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']); }
  finally { bytes.fill(0); }
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export function validateSavePassword(password) {
  if (typeof password !== 'string' || [...password].length < 8 || password.length > 1024 ||
      !/\p{Ll}/u.test(password) || !/\p{Lu}/u.test(password) || !/\p{Nd}/u.test(password)) {
    throw new UserFacingError('Use 8–1024 characters, including a lowercase letter, an uppercase letter and a digit.');
  }
}

export async function encryptSession(data, password) {
  validateSavePassword(password);
  const payload = validatePayload(data);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  let ciphertext;
  try { ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext); }
  finally { plaintext.fill(0); }
  return JSON.stringify({
    v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, cipher: 'AES-GCM',
    salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)),
  });
}

export async function decryptSession(raw, password) {
  const { salt, iv, ciphertext } = readEnvelope(raw);
  if (typeof password !== 'string' || !password.length || password.length > 1024) throw new UserFacingError('Enter the password for your saved login.');
  const key = await deriveKey(password, salt);
  let plaintext;
  try { plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, ciphertext)); }
  catch { throw new UserFacingError('Wrong password or damaged saved login. Try again or sign in again.'); }
  try { return validatePayload(JSON.parse(new TextDecoder().decode(plaintext))); }
  catch { throw new UserFacingError('The saved session is damaged. Forget the saved login and sign in again.'); }
  finally { plaintext.fill(0); }
}

export function hasSavedSession() {
  try { return localStorage.getItem(SESSION_KEY) !== null; } catch { return false; }
}
export function readSavedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw === null) throw new Error();
    return raw;
  } catch { throw new UserFacingError('The saved login is unavailable. Sign in again.'); }
}
export function writeSavedSession(encrypted) {
  // Reject accidental plaintext before it can reach persistent storage.
  const { record } = readEnvelope(encrypted);
  const serialized = JSON.stringify({
    v: record.v, kdf: record.kdf, iterations: record.iterations, cipher: record.cipher,
    salt: record.salt, iv: record.iv, ciphertext: record.ciphertext,
  });
  try {
    localStorage.setItem(SESSION_KEY, serialized);
    if (localStorage.getItem(SESSION_KEY) !== serialized) throw new Error();
  } catch { throw storageError(); }
}
export function forgetSavedSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    if (localStorage.getItem(SESSION_KEY) !== null) throw new Error();
  } catch { throw new UserFacingError('Could not remove the saved login. Clear this site’s data in your browser settings.'); }
}
