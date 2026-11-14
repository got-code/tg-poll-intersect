export interface AuthUser {
  displayName: string;
}

export interface SessionPayload {
  apiId: number;
  apiHash: string;
  session: string;
}

export interface SessionClient {
  exportSession(): Promise<string>;
  importSession(session: string): Promise<void>;
  getApiCredentials(): Promise<{ id: number; hash: string }>;
  destroy(): Promise<void>;
}

export interface QrCallbacks {
  abortSignal: AbortSignal;
  onUrlUpdated(url: string, expires: Date): void;
  onQrScanned(): void;
}

export interface AuthGateway<Client extends SessionClient> {
  sendCode(
    client: Client,
    phone: string,
  ): Promise<AuthUser | { codeToken: string; delivery: CodeDelivery }>;
  signIn(client: Client, phone: string, codeHash: string, code: string): Promise<AuthUser>;
  qr(client: Client, callbacks: QrCallbacks): Promise<AuthUser>;
  password(client: Client, password: string): Promise<AuthUser>;
  me(client: Client): Promise<AuthUser>;
  logout(client: Client): Promise<void>;
}

export interface SavedSessions {
  hasSavedSession(): boolean;
  readSavedSession(): string;
  writeSavedSession(encrypted: string): void;
  forgetSavedSession(): void;
  encryptSession(data: SessionPayload, password: string): Promise<string>;
  decryptSession(raw: string, password: string): Promise<SessionPayload>;
}

export interface AuthDependencies<Client extends SessionClient> {
  createClient(
    this: void,
    apiId: number,
    apiHash: string,
    options?: { qrLogin: boolean },
  ): Promise<Client>;
  auth: AuthGateway<Client>;
  sessions: SavedSessions;
}

export type LoginMethod = 'phone' | 'qr';
export type CodeDelivery = 'app' | 'sms' | 'call' | 'email' | 'sms_word' | 'sms_phrase';
export type LoginKind = 'signed-in' | 'saved' | 'unlocked' | 'memory';
export type LoginResult =
  | { step: 'code'; delivery: CodeDelivery }
  | { step: 'password' }
  | { step: 'save' }
  | { step: 'complete'; user: AuthUser; kind: LoginKind }
  | null;

export interface LoginCredentials {
  apiId: string;
  apiHash: string;
  phone?: string;
  method?: LoginMethod;
  remember?: boolean;
  onUrlUpdated?(this: void, url: string, expires: Date): void;
  onQrScanned?(this: void): void;
}

export interface SignOutResult {
  revoked: boolean;
  storageError: unknown;
}

export interface AuthSession {
  isConnected(this: void): boolean;
  hasSavedLogin(this: void): boolean;
  validateSavePassword(password: string): void;
  begin(credentials: LoginCredentials): Promise<LoginResult>;
  submitCode(code: string): Promise<LoginResult>;
  submitPassword(password: string): Promise<LoginResult>;
  save(password: string): Promise<LoginResult>;
  unlock(password: string): Promise<LoginResult>;
  cancel(): void;
  signOut(): Promise<SignOutResult>;
  skipSaving(): LoginResult;
  forgetSavedLogin(): void;
}
