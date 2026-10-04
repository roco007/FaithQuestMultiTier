import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService, type InventoryItemDto } from './inventory.service.js';
import { CurrentUser, type RequestUser } from '../common/decorators/auth.decorators.js';

/** `/api/v1/inventory` — the authenticated player's relics. */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'Items held by the caller' })
  findAll(@CurrentUser() user: RequestUser): Promise<InventoryItemDto[]> {
    return this.inventory.findAllFor(user.id);
  }
}