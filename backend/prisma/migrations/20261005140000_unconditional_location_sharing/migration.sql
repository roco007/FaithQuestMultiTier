-- Location sharing is now unconditional: every team reports its position while a
-- round is in progress, so the per-player consent flag has no remaining job.
--
-- Dropped rather than left in place, because a `locationShared` column that is
-- always true would be a second source of truth that can disagree with the
-- coordinates beside it. No data migration is needed — every column this feature
-- owns is nullable, and the index only ever covered this flag.
ALTER TABLE `HuntParticipant` DROP INDEX `HuntParticipant_huntId_locationShared_idx`;

ALTER TABLE `HuntParticipant` DROP COLUMN `locationShared`;
