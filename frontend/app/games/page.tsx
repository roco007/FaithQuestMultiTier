'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Gamepad2, Plus, LogIn, LogOut, Play, Trash2, Share2, MapPin, Link2, ShieldCheck, Users } from 'lucide-react';
import { useHunt } from '../../context/HuntContext';
import { useGame } from '../../context/GameContext';
import { useAuth } from '../../context/AuthContext';
import { evaluateProximity } from '../../utils/geo';
import { buildGameJoinUrl, buildGameShareMessage, currentOrigin, getShareSubject } from '../../services/shareGame';
import { decodeGameShareCode, encodeGameShareCode } from '../../services/gameRepository';
import { HuntPlay } from '../../components/HuntPlay';
import { JoinPreflight } from '../../components/JoinPreflight';
import { KeyInHand } from '../../components/KeyInHand';
import { Modal } from '../../components/Modal';
import { ShareLink } from '../../components/ShareLink';
import { TeamNameField } from '../../components/TeamNameField';
import { useShortLink } from '../../hooks/useShortLink';
import type { HuntGame } from '../../types/hunt';

/**
 * Steps of the invite-link flow. `confirm` never mutates anything, `name` is
 * the identity prompt every join passes through, and `permissions` is the
 * device checklist that finally calls `joinGame`.
 */
type InviteStage = 'confirm' | 'name' | 'permissions';

export default function GamesPage() {
  const {
    createdGames,
    activeGame,
    activeProgress,
    activeRoute,
    currentCharacter,
    isLoading,
    createGame,
    deleteGame,
    joinGame,
    leaveGame,
  } = useHunt();

  const [joinInput, setJoinInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [playing, setPlaying] = useState(false);
  /**
   * The team name (signed-in) or username (guest) the player enters on every
   * join — shared by the code box and the invite flow, so a player who just
   * picked a name does not have to pick it again. Joining never asks for an
   * account; creating a hunt does (see the "New hunt" gate below).
   */
  const [teamName, setTeamName] = useState('');
  const { status: authStatus, user } = useAuth();
  /** No session means the player is naming *themselves*, not a team. */
  const isGuest = authStatus !== 'authenticated';
  /**
   * Hunt whose share sheet is open, from a card's Share button. Holding the
   * game rather than its id keeps the sheet's link stable while it is open.
   */
  const [sharing, setSharing] = useState<HuntGame | null>(null);
  /**
   * Hunt carried by an incoming `#join=…` deep link. The player is asked before
   * anything is saved, so opening someone's link never silently replaces the
   * hunt they are already playing.
   */
  const [invited, setInvited] = useState<HuntGame | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  /**
   * The device-permission checklist, shown between accepting an invite and
   * joining it. Precise location and camera are the two things a hunt cannot
   * run without, and both fail quietly once refused — a hunt joined without
   * them looks fine until the map never notices the player arriving and the AR
   * view never produces a frame.
   */
  const [inviteStage, setInviteStage] = useState<InviteStage>('confirm');

  // A signed-in player's own name is the obvious team name — offer it rather
  // than making them retype it. Never clobbers a name already typed.
  useEffect(() => {
    const fallback = user?.displayName?.trim() || user?.username;
    if (!fallback) return;
    setTeamName(prev => (prev.trim() ? prev : fallback));
  }, [user]);

  /** Consumes the invite fragment exactly once, on arrival. */
  useEffect(() => {
    const readInvite = () => {
      const raw = window.location.hash.startsWith('#join=')
        ? window.location.hash.slice('#join='.length)
        : '';
      if (!raw) return;
      // Drop the payload from the address bar first: this effect must not fire
      // again (or re-prompt) if the component remounts later.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const game = decodeGameShareCode(decodeURIComponent(raw));
      if (game) {
        setInvited(game);
        setInviteStage('confirm');
      } else {
        setInviteError('This invite link is damaged or incomplete. Ask the creator to resend it.');
      }
    };
    readInvite();
    // The fragment can also arrive via the back/forward buttons.
    window.addEventListener('hashchange', readInvite);
    return () => window.removeEventListener('hashchange', readInvite);
  }, []);

  /** Adds the invited player to the hunt — only ever called after the player has
   *  confirmed, given the name their team plays under, *and* passed the
   *  device-permission checklist (or chosen to skip it).
   *  `invited` is an already-decoded game, so it is re-encoded through the same
   *  path the paste box uses rather than re-encoding the URL-escaped fragment
   *  (which would double-escape it and fail to decode). */
  const acceptInvite = useCallback(async () => {
    if (!invited) return;
    const name = teamName.trim();
    if (!name) {
      setInviteError('Give us a name for your team before you start.');
      return;
    }
    setJoining(true);
    setInviteError(null);
    try {
      await joinGame(encodeGameShareCode(invited), name);
      setInvited(null);
      setInviteStage('confirm');
      setPlaying(true);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not join that hunt.');
    } finally {
      setJoining(false);
    }
  }, [invited, joinGame, teamName]);

  /** Dismisses the invite from any step, checklist included. */
  const closeInvite = useCallback(() => {
    setInvited(null);
    setInviteError(null);
    setInviteStage('confirm');
  }, []);

  /** True when the invite is the hunt already in progress — no switch needed. */
  const inviteIsActive = Boolean(invited && activeGame && invited.id === activeGame.id);

  const { userLocation } = useGame();
  // Strict visibility: the hunt list never leaks how close the current target
  // is. Its name and clue are legitimately in hand — they arrive with the
  // hand-over, at the hunt's opening for the first stop — but the radius and
  // distance only show once the player is inside the discovery zone.
  const currentTargetRevealed = useMemo(() => {
    if (!currentCharacter || !userLocation) return false;
    return evaluateProximity(userLocation, currentCharacter).isWithinRadius;
  }, [currentCharacter, userLocation]);

  // Route-aware opening-stop check: teams get a shuffled route, so the stop the
  // round opens with is this team's first dealt stop, not authored order 1.
  const isFirstStop = Boolean(
    currentCharacter && activeRoute[0]?.id === currentCharacter.id
  );

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = joinInput.trim();
    const name = teamName.trim();
    if (!value || !name) return;

    setJoining(true);
    setJoinError(null);
    try {
      await joinGame(value, name);
      setJoinInput('');
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join that hunt.');
    } finally {
      setJoining(false);
    }
  };

  /**
   * Creating is the one hunt action that needs an account — joining does not —
   * so the button never even offers itself to an anonymous player. The context
   * refuses the write too; this only makes the rule visible up front.
   */
  const canCreate = authStatus === 'authenticated';

  const handleCreate = async () => {
    await createGame({
      title: 'Untitled Hunt',
      description: '',
      creatorName: 'Mystery Creator',
      endAnnouncement: 'You have found every guardian. Well travelled, seeker!',
      characters: [],
    });
  };

  /**
   * The deep join link for the hunt whose share sheet is open — the full,
   * self-contained one, which is what a device with no backend must be given.
   *
   * `useShortLink` then swaps in a 6-character stand-in for it while the sheet
   * is open. Both open the same invite, so the swap is invisible to anyone who
   * has already copied the long one; `null` (still minting, or no backend) just
   * leaves the full link in place. Declared here, above the early return, so
   * the hook runs on every render regardless of what is on screen.
   */
  const shareUrl = sharing ? buildGameJoinUrl(sharing, currentOrigin()) : '';
  const shortShareUrl = useShortLink(shareUrl);
  const inviteUrl = shortShareUrl ?? shareUrl;

  if (playing && activeGame) {
    return <HuntPlay onExit={() => setPlaying(false)} />;
  }

  return (
    <div className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">Treasure Hunts</h1>
        <p className="pageSubtitle">
          Create a hunt, pin characters to real-world locations, then share the join code with
          players. Anyone can join by giving a team name — no account needed. Creating a hunt
          does need you signed in.
        </p>
      </div>

      {/* --- Join --------------------------------------------------------- */}
      <div className="card joinCard">
        <div className="joinIntro">
          <div className="joinIcon" aria-hidden="true">
            <Gamepad2 size={20} />
          </div>
          <div>
            <h2 className="cardTitle">Join a hunt</h2>
            <p className="cardSubtitle">
              Tell us what to call your team, then paste the hunt number a hunt creator gave you —
              or the whole share message.
            </p>
          </div>
        </div>

        <form className="joinPanel" onSubmit={handleJoin}>
          <TeamNameField
            isGuest={isGuest}
            value={teamName}
            onChange={setTeamName}
            disabled={joining}
          />
          <div className="joinForm">
            <input
              className="input"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="12 or a share code"
              aria-label="Hunt number or share code"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btnPrimary"
              disabled={joining || !joinInput.trim() || !teamName.trim()}
            >
              <LogIn size={16} />
              {joining ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>

        {joinError && (
          <div className="banner bannerWarn" style={{ marginTop: 12, marginBottom: 0 }}>
            {joinError}
          </div>
        )}
      </div>

      {/* --- Active hunt -------------------------------------------------- */}
      {activeGame && activeProgress && (
        <div className="card activeHuntCard">
          <div className="activeHuntMain">
            <div>
              <span className="pill pillActive">Currently playing</span>
              <h2 className="cardTitle" style={{ marginTop: 8 }}>
                {activeGame.title}
              </h2>
              <p className="cardSubtitle">
                {activeProgress.discoveredCharacterIds.length}/{activeGame.characters.length}{' '}
                locations found · by {activeGame.creatorName}
              </p>
            </div>
            <div className="activeHuntActions">
              <button type="button" className="btnPrimary" onClick={() => setPlaying(true)}>
                <Play size={16} />
                {activeProgress.status === 'completed' ? 'Review hunt' : 'Continue hunt'}
              </button>
              <button
                type="button"
                className="btnGhost"
                onClick={() => {
                  leaveGame();
                  setPlaying(false);
                }}
              >
                <LogOut size={15} />
                Leave
              </button>
            </div>
          </div>

          {currentCharacter && (
            <div className="currentTarget">
              <MapPin size={15} style={{ flexShrink: 0, color: 'var(--sky)' }} />
              <span>
                {currentTargetRevealed ? (
                  <>
                    Searching for <strong>{currentCharacter.name}</strong> —{' '}
                    {currentCharacter.hint}
                  </>
                ) : isFirstStop ? (
                  /* The hunt opens with a hand-over: the first location's clue
                     and character are given before anything is walked, and the
                     key that opens it is already in the player's hand. */
                  <>
                    <strong>First clue</strong> — {currentCharacter.name}:{' '}
                    {currentCharacter.hint}
                  </>
                ) : (
                  /* Routes are shuffled per team, so the reliable clue for the
                     next stop is the target's own hint — handed over by the
                     reveal at the stop before it, together with this character
                     and the key that opens it. */
                  <>
                    <strong>Next clue</strong> — {currentCharacter.name}:{' '}
                    {currentCharacter.hint}
                  </>
                )}
              </span>
            </div>
          )}

          {/* The key the player is holding, always on screen: every key arrives
              one stop early — the first with the hunt's opening hand-over, each
              later one with the reveal that ends the stop before it. */}
          <KeyInHand className="keyBarTight" />
        </div>
      )}

      {/* --- Created hunts ------------------------------------------------
          Creating is the one action behind a sign-in: joining is deliberately
          not, so the join card above stays open to anyone. The context enforces
          the same rule; this only stops an anonymous player hitting a dead end. */}
      <div className="sectionHeader">
        <h2 className="sectionTitle">Your hunts</h2>
        {canCreate ? (
          <button type="button" className="btnPrimary" onClick={handleCreate}>
            <Plus size={16} />
            New hunt
          </button>
        ) : authStatus === 'anonymous' ? (
          <Link href="/profile" className="btnGhost">
            <Plus size={16} />
            Sign in to create
          </Link>
        ) : null}
      </div>

      {!canCreate && authStatus === 'anonymous' && (
        <div className="banner bannerInfo" style={{ marginBottom: 18 }}>
          Playing needs no account — pick a team name above and join. Saving a hunt of your own
          needs you signed in first.
        </div>
      )}

      {isLoading ? (
        <div className="card emptyState">Loading…</div>
      ) : createdGames.length === 0 ? (
        <div className="card emptyState">
          <div className="emptyTitle">No hunts yet</div>
          <p>Create your first hunt to start pinning characters to the map.</p>
        </div>
      ) : (
        <div className="huntList">
          {createdGames.map((game) => (
            <div key={game.id} className="card huntRow">
              <div className="huntRowMain">
                <div>
                  <h3 className="huntRowTitle">{game.title}</h3>
                  <p className="huntRowMeta">
                    <span className="mono">{game.id}</span> · {game.characters.length} character
                    {game.characters.length === 1 ? '' : 's'} · {game.creatorName}
                  </p>
                </div>
                <div className="huntRowActions">
                  <button
                    type="button"
                    className="btnGhost"
                    onClick={() => setSharing(game)}
                    title="Share this hunt"
                  >
                    <Share2 size={15} />
                    Share
                  </button>
                  <button
                    type="button"
                    className="btnDanger"
                    onClick={() => deleteGame(game.id)}
                    title="Delete this hunt"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- Share a hunt ---------------------------------------------------
          The same sheet the Creator's publish panel uses. A creator sharing
          their own hunt from this list is sharing it with players, so it goes
          to the apps players actually use rather than only to the clipboard. */}
      <Modal
        open={sharing !== null}
        onClose={() => setSharing(null)}
        title={sharing ? `Share "${sharing.title}"` : 'Share'}
        icon={<Share2 size={18} />}
        accentColor="var(--sky)"
      >
        {sharing && (
          <>
            <p className="shareLead">
              <strong>{sharing.creatorName}</strong>&rsquo;s hunt {sharing.id} &mdash;{' '}
              {sharing.characters.length} location
              {sharing.characters.length === 1 ? '' : 's'}, with every team dealt its own
              order.
            </p>
            <ShareLink
              url={inviteUrl}
              title={sharing.title}
              text={`Join hunt ${sharing.id} on FaithQuest - ${sharing.characters.length} location${sharing.characters.length === 1 ? '' : 's'}, your own shuffled route.`}
              subject={getShareSubject(sharing)}
            />
            <details className="shareDetails">
              <summary>Show full share text</summary>
              <pre className="sharePreview mono">
                {buildGameShareMessage(sharing, currentOrigin(), shortShareUrl)}
              </pre>
            </details>
          </>
        )}
      </Modal>

      {/* --- Invite from a deep link ---------------------------------------
          Opened when a player's URL carries `#join=…`. Joining is never
          automatic: the player confirms first, so a link that is merely opened
          (previewed in a chat app, opened on a borrowed phone) cannot silently
          replace the hunt they are already playing.

          Confirming does not join either — it advances to the device-permission
          checklist, and only the checklist's own button calls `joinGame`. */}
      <Modal
        open={invited !== null}
        onClose={closeInvite}
        title={
          inviteStage === 'confirm'
            ? "You've been invited to a hunt"
            : inviteStage === 'name'
              ? isGuest
                ? 'Pick a username'
                : 'Name your team'
              : 'Before you start'
        }
        icon={
          inviteStage === 'confirm' ? (
            <Link2 size={18} />
          ) : inviteStage === 'name' ? (
            <Users size={18} />
          ) : (
            <ShieldCheck size={18} />
          )
        }
        accentColor="var(--amber)"
      >
        {invited && inviteStage === 'permissions' && (
          <>
            <p className="shareLead">
              <strong>{invited.creatorName}</strong>&rsquo;s &ldquo;{invited.title}&rdquo; is
              ready for you. Two quick device checks first.
            </p>
            {/* Shown here too: the checklist is the step that finally calls
                `joinGame`, so a rejected hunt has to report itself from here —
                otherwise the failure is silent and the buttons just stop
                responding. */}
            {inviteError && (
              <div className="banner bannerWarn" role="alert">
                {inviteError}
              </div>
            )}
            <JoinPreflight
              onJoin={() => void acceptInvite()}
              onCancel={() => setInviteStage('name')}
              joining={joining}
            />
          </>
        )}

        {/* The identity prompt every join passes through. Advancing does not
            join — it only carries the name forward to the checklist, which is
            the sole step that calls `joinGame`. */}
        {invited && inviteStage === 'name' && (
          <>
            <p className="shareLead">
              {isGuest
                ? <>No account needed — pick the username you want to play as.</>
                : <>Pick the name your team walks this hunt under.</>}
            </p>
            {inviteError && (
              <div className="banner bannerWarn" role="alert">
                {inviteError}
              </div>
            )}
            <form
              className="inviteNameForm"
              onSubmit={(e) => {
                e.preventDefault();
                if (teamName.trim()) setInviteStage('permissions');
              }}
            >
              <TeamNameField
                isGuest={isGuest}
                value={teamName}
                onChange={setTeamName}
                disabled={joining}
              />
              <div className="shareActions">
                <button
                  type="submit"
                  className="btnAmber"
                  disabled={!teamName.trim() || joining}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className="btnGhost"
                  onClick={() => setInviteStage('confirm')}
                >
                  Back
                </button>
              </div>
            </form>
          </>
        )}

        {invited && inviteStage === 'confirm' && (
          <>
            <p className="shareLead">
              <strong>{invited.creatorName}</strong> invites you to join &ldquo;
              {invited.title}&rdquo; ({invited.characters.length} character
              {invited.characters.length === 1 ? '' : 's'}). Do you want to join this hunt now?
            </p>
            {invited.description && <p className="shareLead">{invited.description}</p>}

            {inviteIsActive ? (
              <>
                <div className="banner bannerWarn" style={{ marginBottom: 0 }}>
                  This is the hunt you are already playing — no change needed.
                </div>
                <div className="shareActions">
                  <button
                    type="button"
                    className="btnPrimary"
                    onClick={() => {
                      setInvited(null);
                      setPlaying(true);
                    }}
                  >
                    <Play size={16} />
                    Continue hunt
                  </button>
                </div>
              </>
            ) : (
              <>
                {inviteError && (
                  <div className="banner bannerWarn" role="alert">
                    {inviteError}
                  </div>
                )}
                {activeGame && (
                  <p className="cardSubtitle" style={{ marginBottom: 0 }}>
                    Joining will replace &ldquo;{activeGame.title}&rdquo;, the hunt you are playing
                    now.
                  </p>
                )}
                <div className="shareActions">
                  <button
                    type="button"
                    className="btnAmber"
                    onClick={() => setInviteStage('name')}
                    disabled={joining}
                  >
                    <LogIn size={16} />
                    Yes, join this hunt
                  </button>
                  <button type="button" className="btnGhost" onClick={closeInvite}>
                    No, thanks
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
