import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@banhao/types';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Always 200 while the process is answering, even when the database ping
   * fails — see `HealthResponse` for why a degraded database must not make
   * Cloud Run restart the instance.
   */
  @Public()
  @Get()
  @ApiOkResponse({ description: 'Service is up; the body reports whether the database answered' })
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
