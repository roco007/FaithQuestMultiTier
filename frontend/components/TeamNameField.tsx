'use client';

import { useId } from 'react';

interface TeamNameFieldProps {
  /** Signed-in players name a *team*; players without an account pick a username. */
  isGuest: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Disables the field while a join is in flight. */
  disabled?: boolean;
}

/**
 * The name a player supplies when joining a hunt — asked for on every join
 * path (the code box on `/games` and the invite-link flow), never on create.
 *
 * Presentational only: no form, no submit. Both callers embed it in their own
 * `<form>` so each keeps its own button, layout and error handling while the
 * wording, hint and limits stay in one place.
 */
export function TeamNameField({ isGuest, value, onChange, disabled }: TeamNameFieldProps) {
  const id = useId();

  return (
    <div className="teamNameField">
      <label className="teamNameLabel" htmlFor={id}>
        {isGuest ? 'Choose a username' : 'Name your team'}
      </label>
      <p className="teamNameHint" id={`${id}-hint`}>
        {isGuest
          ? 'No account needed — this is how you will show up in this hunt.'
          : 'What your team is called while you walk this hunt.'}
      </p>
      <input
        id={id}
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={isGuest ? 'e.g. PilgrimTwo' : 'e.g. The Pilgrims'}
        aria-describedby={`${id}-hint`}
        maxLength={80}
        autoComplete="nickname"
        spellCheck={false}
        disabled={disabled}
      />
    </div>
  );
}
