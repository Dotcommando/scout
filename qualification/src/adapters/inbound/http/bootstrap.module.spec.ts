import { Test } from '@nestjs/testing';

import { BootstrapModule } from './bootstrap.module.js';

describe('BootstrapModule', () => {
  it('compiles the Qualification bootstrap module', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [BootstrapModule],
    }).compile();

    expect(testingModule).toBeDefined();

    await testingModule.close();
  });
});
