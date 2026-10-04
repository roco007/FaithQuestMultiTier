import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/exceptions/api.exception.js';
import { toQuestNodeDto, type QuestNodeDto } from './quest.mapper.js';
import type { FindQuestsQueryDto } from './dto/quest.dto.js';
import type { Paginated } from '../common/dto/pagination-query.dto.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Read side of the quest catalogue — the seeded church landmarks that the
 * frontend previously imported statically from `data/church_nodes.json`.
 */
@Injectable()
export class QuestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated, filterable catalogue in the frontend's `ChurchNode` shape. */
  async findAll(query: FindQuestsQueryDto): Promise<Paginated<QuestNodeDto>> {
    const where: Prisma.QuestNodeWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.type ? { type: query.type as Prisma.QuestNodeWhereInput['type'] } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.questNode.count({ where }),
      this.prisma.questNode.findMany({
        where,
        include: { rewardBadge: true, rewardItem: true },
        orderBy: { createdAt: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
    ]);

    return {
      items: rows.map(toQuestNodeDto),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(idOrSlug: string): Promise<QuestNodeDto> {
    const node = await this.findEntityOrFail(idOrSlug);
    return toQuestNodeDto(node);
  }

  /**
   * Resolves a quest by UUID **or** slug.
   *
   * Accepting both is what lets the migrated frontend keep addressing landmarks
   * by the ids already in its local progress (`node_01_chapel`) while the API
   * works in UUIDs internally.
   */
  async findEntityOrFail(
    idOrSlug: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const node = await client.questNode.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { rewardBadge: true, rewardItem: true },
    });
    if (!node) {
      throw ApiException.notFound('NOT_FOUND', 'That quest does not exist.');
    }
    return node;
  }
}