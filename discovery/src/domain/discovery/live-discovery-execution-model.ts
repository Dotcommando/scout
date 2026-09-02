export enum LIVE_DISCOVERY_EXECUTION_PURPOSE {
  APPROVED_COLLECTION = 'approved-collection',
  PREFLIGHT = 'preflight',
}

export enum LIVE_DISCOVERY_EXECUTION_STATUS {
  ACTIVE = 'active',
  PAUSED = 'paused',
}

export enum LIVE_DISCOVERY_PAUSE_REASON {
  ARTIFACT_WRITE_FAILURE = 'artifact-write-failure',
  UNIQUE_YIELD_THRESHOLD = 'unique-yield-threshold',
}
