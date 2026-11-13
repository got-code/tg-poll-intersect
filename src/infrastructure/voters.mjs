import { UserFacingError } from '../domain/errors.mjs';
// Each option is paginated separately, including options with zero voters.
// A changing count or repeated cursor means the snapshot cannot be trusted.
export async function readVoters(fetchPage, expected) {
  const ids = new Set();
  const names = {};
  const offsets = new Set();
  let offset = '', count;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const page = await fetchPage(offset);
    if (!Number.isInteger(page.count) || page.count < 0) throw new UserFacingError('Telegram returned an invalid vote count.');
    count ??= page.count;
    if (count !== page.count) throw new UserFacingError('Votes changed while loading. Refresh the results again.');
    for (const person of page.people) {
      ids.add(String(person.id));
      names[String(person.id)] = person.name;
    }
    const next = page.nextOffset;
    if (!next) {
      if (ids.size !== count || (expected != null && expected !== count)) {
        throw new UserFacingError('The voter list is incomplete or votes changed. Refresh the results again.');
      }
      return { ids: [...ids], names };
    }
    if (offsets.has(next)) throw new UserFacingError('Telegram repeated a voter page. Try refreshing later.');
    offsets.add(next);
    offset = next;
  }
  throw new UserFacingError('Too many voter pages.');
}

