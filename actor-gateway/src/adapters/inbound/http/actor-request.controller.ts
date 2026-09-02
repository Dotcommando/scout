import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  parseActorGatewayResolveRequest,
} from '@scout/contracts';

import { ActorGatewayService } from '../../../app/actor/actor-gateway.service.js';

@Controller('v1/actor-requests')
export class ActorRequestController {
  public constructor(
    private readonly actorGatewayService: ActorGatewayService,
  ) {}

  @Get(':requestId')
  public async getRequestStatus(@Param('requestId') requestId: string) {
    const status = await this.actorGatewayService.getRequestStatus(requestId);

    if (status === null) {
      throw new NotFoundException('actor request was not found');
    }

    return status;
  }

  @Get('archives/:archiveId')
  public async getArchiveManifest(@Param('archiveId') archiveId: string) {
    const manifest = await this.actorGatewayService.getArchiveManifest(archiveId);

    if (manifest === null) {
      throw new NotFoundException('archive manifest was not found');
    }

    return manifest;
  }

  @Get('archives/:archiveId/content')
  public async getArchiveContent(
    @Param('archiveId') archiveId: string,
    @Res() response: IHttpResponse,
  ): Promise<void> {
    const content = await this.actorGatewayService.getArchiveContent(archiveId);

    if (content === null) {
      throw new NotFoundException('archive content was not found');
    }

    response.contentType('application/octet-stream').send(content);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  public async resolveRequest(@Body() request: unknown) {
    return this.actorGatewayService.resolveRequest(
      parseActorGatewayResolveRequest(request),
    );
  }
}

export const ACTOR_REQUEST_CONTROLLER_SCHEMA_VERSION =
  ACTOR_GATEWAY_SCHEMA_VERSION.V1;

interface IHttpResponse {
  contentType(contentType: string): IHttpResponse;
  send(content: Uint8Array): void;
}
