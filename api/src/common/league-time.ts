/** Leagues play in Connecticut; "today" and "this week" use Eastern time. */
const LEAGUE_TIME_ZONE = 'America/New_York';
export const todayInLeague = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: LEAGUE_TIME_ZONE }).format(now);
