import { Module } from '@nestjs/common';
import { BadgesController } from './badges.controller.js';
import { BadgesService } from './badges.service.js';

@Module({
  controllers: [BadgesController],
  providers: [BadgesService],
  exports: [BadgesService],
})
export class BadgesModule {}