import type { PollData } from '../domain/models.ts';
import type { PollLink } from './links.ts';

export type PollProgress = { kind: 'loading'; index: number; total: number } | { kind: 'checking' };

export interface PollSource {
  load(links: readonly PollLink[], progress: (event: PollProgress) => void): Promise<PollData>;
}
