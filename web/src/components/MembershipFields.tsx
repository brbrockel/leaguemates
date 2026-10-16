import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type LeagueRole, type RosterPlayer } from '@/lib/api';

export interface Membership {
  role: LeagueRole;
  plays: boolean;
  /** 'new' for a new player, else an existing player's id. */
  player: string;
  nickname: string;
}

export const NEW_MEMBERSHIP: Membership = {
  role: 'user',
  plays: true,
  player: 'new',
  nickname: '',
};

/** Request body for the membership part of POST /users. */
export function membershipBody(m: Membership) {
  return {
    role: m.role,
    ...(m.plays
      ? m.player === 'new'
        ? { newPlayer: m.nickname.trim() ? { nickname: m.nickname.trim() } : {} }
        : { playerId: m.player }
      : {}),
  };
}

/**
 * Role in the league, and whether they play: as a new player or linked to an existing one
 * (for someone already on the schedules, e.g. from past seasons). Untick for people who only
 * watch or help run the league.
 */
export function MembershipFields({
  leagueId,
  value,
  onChange,
  suggestedNickname,
}: {
  leagueId: string;
  value: Membership;
  onChange: (m: Membership) => void;
  suggestedNickname: string;
}) {
  const roster = useQuery({
    queryKey: ['league', leagueId, 'members'],
    queryFn: () => api<{ players: RosterPlayer[] }>(`/leagues/${leagueId}/members`),
    enabled: Boolean(leagueId),
  });
  const unlinked = (roster.data?.players ?? []).filter((p) => !p.userId);
  // Suggest an existing player with the same name.
  const match = unlinked.find(
    (p) => p.nickname.toLowerCase() === suggestedNickname.toLowerCase() && suggestedNickname,
  );
  useEffect(() => {
    if (match && value.player === 'new' && !value.nickname)
      onChange({ ...value, player: match.id });
    // Only when a new match appears, so a deliberate choice isn't overridden.
  }, [match?.id]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="member-role">Role in the league</Label>
        <Select
          id="member-role"
          value={value.role}
          onChange={(e) => onChange({ ...value, role: e.target.value as LeagueRole })}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.plays}
          onChange={(e) => onChange({ ...value, plays: e.target.checked })}
        />
        Plays in this league
      </label>
      {value.plays && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-player">Player</Label>
            <Select
              id="member-player"
              value={value.player}
              onChange={(e) => onChange({ ...value, player: e.target.value })}
            >
              <option value="new">New player</option>
              {unlinked.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                  {p.active ? '' : ' (past player)'}
                </option>
              ))}
            </Select>
          </div>
          {value.player === 'new' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="member-nickname">Nickname</Label>
              <Input
                id="member-nickname"
                value={value.nickname}
                onChange={(e) => onChange({ ...value, nickname: e.target.value })}
                placeholder={suggestedNickname || 'First name'}
              />
            </div>
          )}
        </div>
      )}
      {!value.plays && (
        <p className="text-xs text-muted-foreground">
          They can sign in and see the league, but won't be on rosters or schedules.
        </p>
      )}
    </div>
  );
}
