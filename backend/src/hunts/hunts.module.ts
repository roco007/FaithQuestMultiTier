import { Module } from '@nestjs/common';
import { HuntsController } from './hunts.controller.js';
import { HuntsService } from './hunts.service.js';
import { HuntRouteService } from './services/hunt-route.service.js';
import { HuntGateService } from './services/hunt-gate.service.js';

@Module({
  controllers: [HuntsController],
  providers: [HuntsService, HuntRouteService, HuntGateService],
  exports: [HuntsService],
})
export class HuntsModule {}