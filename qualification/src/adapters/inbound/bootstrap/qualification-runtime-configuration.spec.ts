import {
  createQualificationRuntimeConfiguration,
  RuntimeConfigurationValidationError,
} from './qualification-runtime-configuration.js';

describe('createQualificationRuntimeConfiguration', () => {
  it('maps valid Qualification environment values', () => {
    const configuration = createQualificationRuntimeConfiguration(
      {
        QUALIFICATION_MONGODB_URI:
          'mongodb://localhost:27017/scout_qualification',
        QUALIFICATION_PORT: '3002',
      },
      '/workspace/.env',
    );

    expect(configuration.port).toBe(3002);
    expect(configuration.mongodbUri).toBe(
      'mongodb://localhost:27017/scout_qualification',
    );
  });

  it('reports invalid ports with a precise field path', () => {
    expect(() =>
      createQualificationRuntimeConfiguration(
        {
          QUALIFICATION_MONGODB_URI:
            'mongodb://localhost:27017/scout_qualification',
          QUALIFICATION_PORT: 'not-a-port',
        },
        '/workspace/.env',
      ),
    ).toThrow(RuntimeConfigurationValidationError);
  });
});
