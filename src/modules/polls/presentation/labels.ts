// The ordinal distinguishes duplicate questions without exposing poll identities.
export function pollLabels(polls: readonly { title?: string }[]): string[] {
  const titles = polls.map((poll, index) => poll.title?.trim() || `Poll ${index + 1}`);
  const counts = new Map<string, number>();
  titles.forEach((title) => counts.set(title, (counts.get(title) ?? 0) + 1));
  return titles.map((title, index) => (counts.get(title)! > 1 ? `${title} · ${index + 1}` : title));
}
