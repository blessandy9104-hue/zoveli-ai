/**
 * Single source of truth for the product version surfaced to users
 * (`assistant --version`, health reports, agent metadata). `pnpm release:check`
 * enforces that this matches the root package.json.
 */
export const ZOVELI_VERSION = '0.1.0';
