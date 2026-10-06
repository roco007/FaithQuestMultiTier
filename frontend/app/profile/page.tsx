'use client';

import { useEffect, useState } from 'react';
import { Trophy, Award, CheckCircle2, Lock, Flame, Users } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { useAuth } from '../../context/AuthContext';
import { leaderboardApi } from '@/lib/api/leaderboard.api';
import { ApiError } from '@/lib/api/client';
import type { LeaderboardEntry } from '@/lib/api/types';

/** Sample field standings — the native build had no backend for this either. */
interface LeaderboardRow {
  rank: number;
  team: string;
  xp: number;
  badge: string;
  isCurrent?: boolean;
}

const LEADERBOARD_DATA: LeaderboardRow[] = [
  { rank: 1, team: 'Trailblazers of Light', xp: 2450, badge: '🥇' },
  { rank: 2, team: 'Sanctuary Seekers', xp: 1980, badge: '🥈' },
  { rank: 3, team: 'Belfry Navigators', xp: 1720, badge: '🥉' },
  { rank: 4, team: 'Young Pilgrims (You)', xp: 0, badge: '🌟', isCurrent: true },
];

const MEDALS = ['🥇', '🥈', '🥉'];

/** API entries → the row shape the card renders (sample rows share it). */
function toLeaderboardRows(entries: LeaderboardEntry[], currentUserId: string | null): LeaderboardRow[] {
  return entries.map((entry) => ({
    rank: entry.rank,
    team: entry.displayName || entry.username,
    xp: entry.totalXp,
    badge: MEDALS[entry.rank - 1] ?? '🌟',
    isCurrent: Boolean(currentUserId) && entry.userId === currentUserId,
  }));
}

/** Trophies & stats, ported from the native profile tab. */
export default function ProfilePage() {
  const { progress } = useGame();
  const unlockedBadgesCount = progress.badges.filter((b) => b.isUnlocked).length;

  const { status: authStatus, user, configured, signIn, signUp, signOut } = useAuth();

  // Field standings: the leaderboard API when it answers (plan §3), the sample
  // rows otherwise — an unconfigured or offline install keeps the old table.
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await leaderboardApi.list({ limit: 10 });
        if (!cancelled) setRows(toLeaderboardRows(page.items, user?.id ?? null));
      } catch {
        // Not configured or unreachable — keep the sample rows.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Account card form state.
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (mode === 'signin') {
        await signIn({ email: email.trim(), password });
      } else {
        await signUp({
          email: email.trim(),
          username: username.trim(),
          password,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        });
      }
      setPassword('');
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="page">
      {/* Account — sign in / create account / sign out (plan §3). Renders the
          local-only note instead whenever no backend is configured. */}
      <h2 className="sectionTitle">Account</h2>
      <div className="card profileCard">
        {!configured ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
            Playing locally — no backend configured (<code>NEXT_PUBLIC_API_URL</code>).
            Progress and hunts live on this device.
          </p>
        ) : authStatus === 'loading' ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>Checking your session…</p>
        ) : user ? (
          <div className="profileAvatarRow">
            <div className="profileNameBlock">
              <div className="profilePlayerName">{user.displayName ?? user.username}</div>
              <div className="profileRank">
                {user.email} · Level {user.level} · {user.totalXp} XP
              </div>
            </div>
            <button
              type="button"
              className="btnGhost"
              style={{ marginLeft: 'auto' }}
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        ) : (
          <form onSubmit={submitAccount} style={{ display: 'grid', gap: 10 }}>
            <input
              className="input"
              type="email"
              required
              placeholder="Email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode === 'register' && (
              <input
                className="input"
                required
                placeholder="Username"
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
            <input
              className="input"
              type="password"
              required
              minLength={mode === 'register' ? 8 : undefined}
              placeholder="Password"
              value={password}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && (
              <input
                className="input"
                placeholder="Display name (optional)"
                value={displayName}
                autoComplete="name"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            {formError && (
              <p style={{ margin: 0, fontSize: 13, color: '#f87171' }}>{formError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btnPrimary" type="submit" disabled={busy}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
              <button
                className="btnGhost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'signin' ? 'register' : 'signin');
                  setFormError(null);
                }}
              >
                {mode === 'signin' ? 'Create account' : 'I already have an account'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="pageHeader">
        <div className="pageHeaderRow">
          <div className="pageHeaderIcon" style={{ color: 'var(--amber)' }}>
            <Trophy size={26} />
          </div>
          <div>
            <h1 className="pageTitle">Trophies &amp; Stats</h1>
            <p className="pageSubtitle">
              {unlockedBadgesCount}/{progress.badges.length} badges unlocked
            </p>
          </div>
        </div>
      </div>

      {/* Player summary */}
      <div className="card profileCard">
        <div className="profileAvatarRow">
          <div className="xpLevel">{progress.level}</div>
          <div className="profileNameBlock">
            <div className="profilePlayerName">{progress.playerName}</div>
            <div className="profileRank">{progress.rankTitle}</div>
          </div>
          <div className="streakBadge">
            <Flame size={16} />
            {progress.streakDays} Day
          </div>
        </div>

        <div className="statsSummaryRow">
          <div className="statBox">
            <div className="statVal">{progress.totalXp}</div>
            <div className="statLabel">Total XP</div>
          </div>
          <div className="statBox">
            <div className="statVal">{progress.completedNodeIds.length}</div>
            <div className="statLabel">Solved</div>
          </div>
          <div className="statBox">
            <div className="statVal">{progress.inventory.length}</div>
            <div className="statLabel">Relics</div>
          </div>
        </div>
      </div>

      {/* Badges cabinet */}
      <h2 className="sectionTitle">Badges &amp; Achievements</h2>
      <div className="badgesGrid">
        {progress.badges.map((badge) => (
          <div
            key={badge.id}
            className={`card badgeCard${badge.isUnlocked ? ' badgeCardUnlocked' : ''}`}
          >
            <div
              className={`badgeIconBubble ${
                badge.isUnlocked ? 'badgeIconUnlocked' : 'badgeIconLocked'
              }`}
            >
              {badge.isUnlocked ? (
                <Award size={22} color="#fbbf24" />
              ) : (
                <Lock size={20} color="#64748b" />
              )}
            </div>
            <div className="badgeTitle">{badge.title}</div>
            <div className="badgeDesc">{badge.description}</div>
            {badge.isUnlocked && (
              <span className="unlockedTag">
                <CheckCircle2 size={11} />
                Unlocked
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <h2 className="sectionTitle">
        <Users size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
        Field Standings
      </h2>
      <div className="card leaderboardCard">
        {(rows ?? LEADERBOARD_DATA).map((row) => (
          <div
            key={row.rank}
            className={`leaderboardRow${row.isCurrent ? ' leaderboardRowCurrent' : ''}`}
          >
            <span className="leaderboardMedal" aria-hidden="true">
              {row.badge}
            </span>
            <div>
              <div className="teamName">{row.team}</div>
              <div className="teamRank">Rank #{row.rank}</div>
            </div>
            <div className="teamXp" style={{ marginLeft: 'auto' }}>
              {row.isCurrent ? `${progress.totalXp} XP` : `${row.xp} XP`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}