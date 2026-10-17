import {
  Bug,
  CalendarDays,
  Check,
  ChevronDown,
  Flag,
  Home,
  LogIn,
  LogOut,
  History,
  SlidersHorizontal,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useMe, useSignOut } from '@/auth/session';
import { Logo } from '@/components/logo';
import { ReportProblemDialog } from '@/components/ReportProblem';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useCurrentLeague } from '@/lib/useCurrentLeague';

export function AppLayout() {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { leagueId } = useParams();
  const current = useCurrentLeague(leagueId);
  const { pathname } = useLocation();
  const [reporting, setReporting] = useState(false);
  /** A tab also counts as active on its related pages (Schedule on season pages). */
  const onAlso = (t: { also?: string[] }) => Boolean(t.also?.some((p) => pathname.startsWith(p)));
  if (!me) return null;
  const isAdmin = me.user.isSiteAdmin || me.leagues.some((l) => l.role === 'admin');

  const tabs = [
    { to: '/', label: 'Home', icon: Home, end: true },
    ...(current
      ? [
          {
            to: `/leagues/${current.id}/schedule`,
            label: 'Schedule',
            icon: CalendarDays,
            end: false,
            also: [`/leagues/${current.id}/seasons/`],
          },
          { to: `/leagues/${current.id}/standings`, label: 'Standings', icon: Trophy, end: true },
          {
            to: `/leagues/${current.id}`,
            label: 'League',
            icon: Flag,
            end: true,
            also: [
              `/leagues/${current.id}/players/`,
              `/leagues/${current.id}/handicaps`,
              `/leagues/${current.id}/photos`,
            ],
          },
        ]
      : []),
    ...(isAdmin ? [{ to: '/people', label: 'People', icon: Users, end: true }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="size-7" />
            <span>TeeMate</span>
          </NavLink>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                    (isActive || onAlso(t)) && 'bg-accent text-accent-foreground',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {me.leagues.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-w-[48vw] sm:max-w-xs"
                    aria-label="Switch league"
                  >
                    <span className="truncate">{current?.name ?? 'League'}</span>
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Leagues</DropdownMenuLabel>
                  {me.leagues.map((l) => (
                    <DropdownMenuItem key={l.id} onSelect={() => navigate(`/leagues/${l.id}`)}>
                      {l.id === current?.id ? <Check /> : <span className="size-4" />}
                      {l.name}
                      {l.role === 'viewer' && (
                        <span className="ml-auto text-xs text-muted-foreground">Public</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {me.user.isGuest ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => signOut.mutate(undefined, { onSettled: () => navigate('/sign-in') })}
              >
                <LogIn /> Sign in
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Account menu">
                    <UserRound />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{me.user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/account')}>
                    <UserRound /> Account
                  </DropdownMenuItem>
                  {me.user.isSiteAdmin && (
                    <>
                      <DropdownMenuItem onSelect={() => navigate('/site-settings')}>
                        <SlidersHorizontal /> Site settings
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => navigate('/activity')}>
                        <History /> Activity log
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onSelect={() => setReporting(true)}>
                    <Bug /> Report a problem
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      signOut.mutate(undefined, { onSettled: () => navigate('/sign-in') })
                    }
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>
      <ReportProblemDialog open={reporting} onClose={() => setReporting(false)} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 md:pb-10">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-md">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs text-muted-foreground',
                  (isActive || onAlso(t)) && 'text-primary',
                )
              }
            >
              <t.icon className="size-5" aria-hidden />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
