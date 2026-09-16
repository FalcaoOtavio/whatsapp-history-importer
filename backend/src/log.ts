/**
 * Error logging that cannot leak database credentials.
 *
 * `DATABASE_URL` and `MONGODB_URL` are full connection strings, password
 * included. When one of them is malformed, the driver throws an error whose
 * message quotes the string back verbatim - so a plain `console.error(err)`
 * prints the user's Postgres password to stderr, where it lands in shell
 * scrollback and in the launcher's log file. Scrub the userinfo segment of any
 * URL-ish token before anything is printed.
 */

// scheme://user:password@host -> scheme://user:***@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]*)@/gi;

/** Replaces the password in every `scheme://user:pass@host` found in `text`. */
export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, (_match, scheme, user) => `${scheme}${user}:***@`);
}

/** Turns anything thrown into a single-line, credential-free string. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return redactSecrets(`${error.name}: ${error.message}`);
  }
  return redactSecrets(String(error));
}

/**
 * Reports a non-fatal background failure.
 *
 * Mirror writes, credential saves and media downloads all run detached from a
 * request; when one fails the app keeps working off SQLite, so these must be
 * logged rather than rethrown into an unhandled rejection that kills the
 * sidecar.
 */
export function logBackgroundError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${context}] ${describeError(error)}`);
}

/** Attaches `.catch()` to a detached promise so it can never go unhandled. */
export function fireAndForget(context: string, promise: Promise<unknown>): void {
  void promise.catch((error: unknown) => logBackgroundError(context, error));
}

/**
 * Last-resort process guards.
 *
 * A rejection with no handler terminates Node with a non-zero exit code by
 * default. The sidecar is a long-lived background process the user never sees a
 * terminal for, so a single failed mirror write would silently take the whole
 * app down. Log and stay up instead.
 */
export function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    logBackgroundError("unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    logBackgroundError("uncaughtException", error);
  });
}
