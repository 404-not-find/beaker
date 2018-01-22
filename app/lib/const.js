import bytes from 'bytes'
import ms from 'ms'

// 64 char hex
export const DAT_HASH_REGEX = /^[0-9a-f]{64}$/i
export const DAT_URL_REGEX = /^(?:dat:\/\/)?([0-9a-f]{64})/i

// url file paths
export const DAT_VALID_PATH_REGEX = /^[a-z0-9\-._~!$&'()*+,;=:@/\s]+$/i

// dat settings
export const DAT_SWARM_PORT = 3282
export const DAT_MANIFEST_FILENAME = 'dat.json'
export const DAT_QUOTA_DEFAULT_ARCHIVES_ALLOWED = process.env.beaker_dat_quota_default_archives_allowed || 5
export const DAT_QUOTA_DEFAULT_BYTES_ALLOWED = bytes.parse(process.env.beaker_dat_quota_default_bytes_allowed || '500mb')
export const DEFAULT_DAT_DNS_TTL = ms('1h')
export const MAX_DAT_DNS_TTL = ms('7d')
export const DEFAULT_DAT_API_TIMEOUT = ms('5s')
export const DAT_GC_EXPIRATION_AGE = ms('7d') // how old do archives need to be before deleting them from the cache?
export const DAT_GC_FIRST_COLLECT_WAIT = ms('30s') // how long after process start to do first collect?
export const DAT_GC_REGULAR_COLLECT_WAIT = ms('15m') // how long between GCs to collect?
// dat.json manifest fields which should be preserved in forks
export const DAT_PRESERVED_FIELDS_ON_FORK = [
  'web_root',
  'fallback_page'
]

// workspace settings
export const WORKSPACE_VALID_NAME_REGEX = /^[a-z][a-z0-9-]*$/i

// archive metadata
// TODO- these may not all be meaningful anymore -prf
export const STANDARD_ARCHIVE_TYPES = [
  'application',
  'module',
  'dataset',
  'documents',
  'music',
  'photos',
  'user-profile',
  'videos',
  'website'
]