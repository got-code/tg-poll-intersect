export const PREFERENCES_KEY = 'poll-intersections.preferences.v1';
export const DEFAULT_TOPIC_MINIMUM = 3;

export function topicMinimum(value) {
  const number = Number(value);
  return typeof value === 'string' && value.trim() === '' || !Number.isSafeInteger(number) || number < 0
    ? DEFAULT_TOPIC_MINIMUM : number;
}

export function readPreferences() {
  const defaults = { links: ['', '', '', ''], topicMinimum: DEFAULT_TOPIC_MINIMUM };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
    return {
      links: Array.isArray(saved?.links) && saved.links.length === 4 && saved.links.every(value => typeof value === 'string') ? saved.links : defaults.links,
      topicMinimum: typeof saved?.topicMinimum === 'number' ? topicMinimum(saved.topicMinimum) : defaults.topicMinimum,
    };
  } catch { return defaults; }
}

export function writePreferences(preferences) {
  try {
    const serialized = JSON.stringify(preferences);
    localStorage.setItem(PREFERENCES_KEY, serialized);
    return localStorage.getItem(PREFERENCES_KEY) === serialized;
  } catch { return false; }
}
