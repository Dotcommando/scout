import { Injectable } from '@nestjs/common';

import { IClockPort } from '../../../ports/outbound/clock.port.js';

@Injectable()
export class SystemClock implements IClockPort {
  public getCurrentTime(): Date {
    return new Date();
  }
}
