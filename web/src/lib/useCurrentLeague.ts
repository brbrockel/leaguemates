import { useEffect } from 'react';
import { useMe } from '@/auth/session';

const KEY = 'teemate-league';

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The league in the URL, else the last one viewed on this device, else the first. */
export function useCurrentLeague(routeLeagueId?: string) {
  const { data: me } = useMe();
  const leagues = me?.leagues ?? [];
  const wanted = routeLeagueId ?? readStored();
  const current = leagues.find((l) => l.id === wanted) ?? leagues[0];

  useEffect(() => {
    if (!routeLeagueId) return;
    try {
      localStorage.setItem(KEY, routeLeagueId);
    } catch {
      // Remembering the league is only a convenience.
    }
  }, [routeLeagueId]);

  return current;
}
