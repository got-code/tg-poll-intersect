import { UserFacingError } from '../../../application/errors.ts';

export function validateSavePassword(password: unknown) {
  if (
    typeof password !== 'string' ||
    [...password].length < 8 ||
    password.length > 1024 ||
    !/\p{Ll}/u.test(password) ||
    !/\p{Lu}/u.test(password) ||
    !/\p{Nd}/u.test(password)
  ) {
    throw new UserFacingError(
      'Use 8–1024 characters, including a lowercase letter, an uppercase letter and a digit.',
    );
  }
}
