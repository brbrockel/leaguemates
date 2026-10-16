import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { useMe } from '@/auth/session';
import { AppLayout } from '@/components/AppLayout';
import { AccountPage } from '@/pages/AccountPage';
import { CoursePage, CoursesPage } from '@/pages/CoursesPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { HandicapsPage } from '@/pages/HandicapsPage';
import { HomePage } from '@/pages/HomePage';
import { LeaguePage } from '@/pages/LeaguePage';
import { LeagueSettingsPage } from '@/pages/LeagueSettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PhotosPage } from '@/pages/PhotosPage';
import { PlayerPage } from '@/pages/PlayerPage';
import { SchedulePage } from '@/pages/SchedulePage';
import { ScorecardPage } from '@/pages/ScorecardPage';
import { SeasonPage } from '@/pages/SeasonPage';
import { StandingsPage } from '@/pages/StandingsPage';
import { SetPasswordPage } from '@/pages/SetPasswordPage';
import { SignInPage } from '@/pages/SignInPage';
import { SiteSettingsPage } from '@/pages/SiteSettingsPage';
import { UsersPage } from '@/pages/UsersPage';
import { VerifyPage } from '@/pages/VerifyPage';

/** Everything except the sign-in pages requires a session. */
function RequireSession() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <div className="min-h-dvh" />;
  if (!me.data) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export const routes = [
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/sign-in/verify', element: <VerifyPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'leagues/:leagueId', element: <LeaguePage /> },
          { path: 'leagues/:leagueId/settings', element: <LeagueSettingsPage /> },
          { path: 'leagues/:leagueId/schedule', element: <SchedulePage /> },
          { path: 'leagues/:leagueId/seasons/:seasonId', element: <SeasonPage /> },
          {
            path: 'leagues/:leagueId/seasons/:seasonId/weeks/:weekId/groups/:groupId',
            element: <ScorecardPage />,
          },
          { path: 'leagues/:leagueId/standings', element: <StandingsPage /> },
          { path: 'leagues/:leagueId/players/:playerId', element: <PlayerPage /> },
          { path: 'leagues/:leagueId/handicaps', element: <HandicapsPage /> },
          { path: 'leagues/:leagueId/photos', element: <PhotosPage /> },
          { path: 'courses', element: <CoursesPage /> },
          { path: 'courses/:courseId', element: <CoursePage /> },
          { path: 'people', element: <UsersPage /> },
          { path: 'people/:userId/activity', element: <ActivityPage scope="person" /> },
          { path: 'site-settings', element: <SiteSettingsPage /> },
          { path: 'activity', element: <ActivityPage scope="site" /> },
          { path: 'leagues/:leagueId/activity', element: <ActivityPage scope="league" /> },
          { path: 'account', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
