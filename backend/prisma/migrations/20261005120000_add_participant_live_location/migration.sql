-- Live player location for the creator's map.
--
-- One mutable slot per participant (`latitude` / `longitude` / `locationAt`),
-- deliberately NOT a trail: the map needs a current fix, and storing history
-- would retain far more about a player's movements than that requires.
--
-- `locationShared` was added here as an opt-in consent flag and removed again by
-- the following migration, once sharing became unconditional. It is kept in this
-- (already-applied) migration so a fresh database replays the same history this
-- one did, rather than failing on a DROP of columns it never gained.
ALTER TABLE `HuntParticipant`
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL,
  ADD COLUMN `locationAt` DATETIME(3) NULL,
  ADD COLUMN `locationShared` BOOLEAN NOT NULL DEFAULT FALSE;

-- The creator's map reads "every player of this hunt whose location is shared",
-- so the lookup is always hunt-scoped and always filtered on the consent flag.
CREATE INDEX `HuntParticipant_huntId_locationShared_idx`
  ON `HuntParticipant` (`huntId`, `locationShared`);

