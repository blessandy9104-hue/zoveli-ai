/**
 * Backup file-format identifiers shared by the writer/verifier and the
 * retention module. Kept in a leaf module so pruning can validate manifests
 * without loading SQLite.
 */
export const BACKUP_FORMAT = 'zoveli-backup';
export const BACKUP_VERSION = 1;
