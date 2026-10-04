-- Player progress tracking: anonymous guests + a per-checkpoint timeline.
--
-- 1. `HuntParticipant.userId` becomes nullable so a guest who opened a share
--    link without an account still gets a row. MySQL is strict about a NOT NULL
--    column losing rows, so the column is widened first, existing rows are left
--    alone (they all have a userId), and the constraint is dropped afterwards.
ALTER TABLE `HuntParticipant` MODIFY COLUMN `userId` VARCHAR(191) NULL;

-- 2. The guest's opaque per-hunt credential. NULL for every signed-in player.
ALTER TABLE `HuntParticipant` ADD COLUMN `guestToken` VARCHAR(64) NULL;

-- 3. Heartbeat for the creator dashboard's "playing now" column.
ALTER TABLE `HuntParticipant` ADD COLUMN `lastSeenAt` DATETIME(3) NULL;

-- 4. One row per guest per hunt. NULLs are distinct in a MySQL unique index, so
--    this coexists with `huntId_userId` and each covers the other's blind spot:
--    signed-in players are deduplicated by one, guests by the other.
ALTER TABLE `HuntParticipant` ADD UNIQUE INDEX `HuntParticipant_huntId_guestToken_key`(`huntId`, `guestToken`);

-- 5. Serves the dashboard's participant list (newest first) without a filesort.
ALTER TABLE `HuntParticipant` ADD INDEX `HuntParticipant_huntId_joinedAt_idx`(`huntId`, `joinedAt`);

-- 6. The timeline itself. This is the only place a per-checkpoint time exists:
--    `discoveredNodeIds` records which stops were cleared but never when, and a
--    JSON array cannot carry a timestamp per element.
CREATE TABLE `HuntCheckpointEvent` (
    `id` VARCHAR(191) NOT NULL,
    `participantId` VARCHAR(191) NOT NULL,
    `huntId` VARCHAR(191) NOT NULL,
    `nodeId` VARCHAR(191) NOT NULL,
    `routePosition` INTEGER NOT NULL,
    `reachedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `elapsedMs` INTEGER NOT NULL,

    INDEX `HuntCheckpointEvent_huntId_reachedAt_idx`(`huntId`, `reachedAt`),
    INDEX `HuntCheckpointEvent_participantId_routePosition_idx`(`participantId`, `routePosition`),
    UNIQUE INDEX `HuntCheckpointEvent_participantId_nodeId_key`(`participantId`, `nodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 7. No FK to Hunt: the composite indexes above would then be prefixed by it and
--    stop matching the queries they exist for. Cascade is handled in the service.
ALTER TABLE `HuntCheckpointEvent`
    ADD CONSTRAINT `HuntCheckpointEvent_participantId_fkey`
    FOREIGN KEY (`participantId`) REFERENCES `HuntParticipant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;