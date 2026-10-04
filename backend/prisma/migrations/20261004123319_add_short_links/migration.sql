-- CreateTable
CREATE TABLE `ShortLink` (
    `code` VARCHAR(8) NOT NULL,
    `target` TEXT NOT NULL,
    `targetHash` CHAR(64) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `hits` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShortLink_targetHash_key`(`targetHash`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
