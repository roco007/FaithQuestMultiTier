import { Module } from '@nestjs/common';
import { QuestsController } from './quests.controller.js';
import { QuestsService } from './quests.service.js';
import { QuestCompletionService } from './services/quest-completion.service.js';
import { XpService } from './services/xp.service.js';
import { DistanceService } from './services/distance.service.js';
import { BadgeEvaluatorService } from './services/badge-evaluator.service.js';
import { InventoryAwardService } from './services/inventory-award.service.js';

/**
 * Quests: the catalogue, and the authoritative completion path.
 *
 * The game-logic services are listed in `providers` and exported so the hunts
 * module can reuse `DistanceService` and `XpService` instead of growing a second
 * copy of the same rules.
 */
@Module({
  controllers: [QuestsController],
  providers: [
    QuestsService,
    QuestCompletionService,
    XpService,
    DistanceService,
    BadgeEvaluatorService,
    InventoryAwardService,
  ],
  exports: [QuestsService, XpService, DistanceService],
})
export class QuestsModule {}