import { HttpError } from './auth';

/** Error envelope helper shared by the generation routes. */
export function validationError(code: string, message: string, status: number): HttpError {
  return new HttpError(status, message, code);
}
