import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ME_KEY, useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, setCsrfToken, type User } from '@/lib/api';
import { AuthShell } from './SignInPage';

/** Reads the token from the URL fragment once and removes it from the address bar. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

/**
 * Landing page for the emailed link. Signing in needs a button press, so email
 * security scanners that open links automatically can't use up the token.
 */
export function VerifyPage() {
  const [token] = useState(takeToken);
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () =>
      api<{ user: User; csrfToken: string }>('/auth/verify', { method: 'POST', body: { token } }),
    onSuccess: async ({ csrfToken }) => {
      setCsrfToken(csrfToken);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    },
  });

  if (me.data && !verify.isSuccess) {
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>You're already signed in</CardTitle>
            <CardDescription>
              Signed in as {me.data.user.email} on this device. The link wasn't needed, so it still
              works once somewhere else.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg" className="w-full">
              <Link to="/">Continue to TeeMate</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to TeeMate</CardTitle>
          <CardDescription>
            {token
              ? 'Tap the button to finish signing in on this device.'
              : 'This link is missing its sign-in code.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {verify.isError && <Alert variant="destructive">{verify.error.message}</Alert>}
          {token && !verify.isError && (
            <Button size="lg" onClick={() => verify.mutate()} disabled={verify.isPending}>
              {verify.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          )}
          {(!token || verify.isError) && (
            <Button asChild variant="outline">
              <Link to="/sign-in">Get a new link</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
