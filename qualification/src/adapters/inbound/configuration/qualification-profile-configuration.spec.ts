import {
  parseQualificationProfileConfiguration,
  QualificationProfileConfigurationValidationError,
} from './qualification-profile-configuration.js';

const CONFIGURATION_FILE_PATH = '/configuration/profiles.yaml';

describe('parseQualificationProfileConfiguration', () => {
  it('derives a stable profile hash from profile content rather than YAML ordering', () => {
    const first = parseQualificationProfileConfiguration(
      createConfiguration('excluded.example', 'directory', 'external-1', 2),
      CONFIGURATION_FILE_PATH,
    );
    const reordered = parseQualificationProfileConfiguration(
      createConfiguration('excluded.example', 'directory', 'external-1', 2),
      CONFIGURATION_FILE_PATH,
    );

    expect(first.profiles[0]?.version).toBe(2);
    expect(first.profiles[0]?.contentHash).toBe(reordered.profiles[0]?.contentHash);
  });

  it('changes the profile hash when its version changes', () => {
    const first = parseQualificationProfileConfiguration(
      createConfiguration('excluded.example', 'directory', 'external-1', 1),
      CONFIGURATION_FILE_PATH,
    );
    const revised = parseQualificationProfileConfiguration(
      createConfiguration('excluded.example', 'directory', 'external-1', 2),
      CONFIGURATION_FILE_PATH,
    );

    expect(first.profiles[0]?.contentHash).not.toBe(
      revised.profiles[0]?.contentHash,
    );
  });

  it('reports the configuration path and field for invalid requirements', () => {
    expect(() => parseQualificationProfileConfiguration(
      createConfiguration('excluded.example', 'directory', 'external-1', 1)
        .replace('name: true', 'name: required'),
      CONFIGURATION_FILE_PATH,
    )).toThrow(
      new QualificationProfileConfigurationValidationError(
        CONFIGURATION_FILE_PATH,
        'profiles[0].requirements.name',
        'must be a boolean',
      ),
    );
  });
});

function createConfiguration(
  host: string,
  sourceKind: string,
  externalId: string,
  profileVersion: number,
): string {
  return `version: 1
profiles:
  - campaignId: campaign-1
    profileId: baseline
    profileVersion: ${profileVersion}
    requirements:
      name: true
      address: false
      phoneNumber: false
      websiteUrl: false
    excludedSourceIdentities:
      - sourceKind: ${sourceKind}
        externalId: ${externalId}
    excludedWebsiteHosts:
      - ${host}
`;
}
