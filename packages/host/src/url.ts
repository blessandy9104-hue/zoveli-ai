/**
 * Remove every trailing `/` without a regex. Provider base URLs come from
 * environment variables, and a backtracking pattern over untrusted input is
 * both unnecessary and a CodeQL finding.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}
