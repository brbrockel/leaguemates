import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ME_KEY } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, setCsrfToken, type User } from '@/lib/api';
import { AuthShell } from './SignInPage';

/** Reads the token from the URL fragment once and removes it from the address bar. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

export const PASSWORD_HINT =
  'At least 10 characters. A few unrelated words make a strong, easy-to-type password. Very common passwords are refused.';

/**
 * Where an admin's password link lands: set (or reset) the password, then you're signed in.
 * Opening the link doesn't use it up; saving does.
 */
export function SetPasswordPage() {
  const [token] = useState(takeToken);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const link = useQuery({
    queryKey: ['password-link', token],
    queryFn: () =>
      api<{ email: string; name: string | null; hasPassword: boolean }>(
        '/auth/password-link/check',
        { method: 'POST', body: { token } },
      ),
    enabled: Boolean(token),
    retry: false,
  });
  const signedIn = async ({ csrfToken }: { csrfToken: string }) => {
    setCsrfToken(csrfToken);
    await qc.invalidateQueries({ queryKey: ME_KEY });
    navigate('/', { replace: true });
  };
  const save = useMutation({
    mutationFn: () =>
      api<{ user: User; csrfToken: string } | { needsCode: true }>('/auth/password-link', {
        method: 'POST',
        body: { token, password },
      }),
    onSuccess: async (r) => {
      if ('needsCode' in r) setNeedsCode(true);
      else await signedIn(r);
    },
  });
  // The password is saved by now; this is an ordinary sign-in with it and the code.
  const signIn = useMutation({
    mutationFn: () =>
      api<{ user: User; csrfToken: string } | { needsCode: true }>('/auth/login', {
        method: 'POST',
        body: { email: link.data?.email, password, code },
      }),
    onSuccess: async (r) => {
      if (!('needsCode' in r)) await signedIn(r);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (needsCode) signIn.mutate();
    else save.mutate();
  };
  const mismatch = again.length > 0 && again !== password;

  if (!token || link.isError)
    return (
      <AuthShell>
        <Card>
          <CardHeader>
            <CardTitle>This link doesn't work</CardTitle>
            <CardDescription>
              {link.error?.message ??
                'The link is missing its code. Check that the whole link was copied.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/sign-in">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthShell>
    );

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden />
            {link.data?.hasPassword ? 'Reset your password' : 'Set your password'}
          </CardTitle>
          <CardDescription>
            {link.data ? (
              <>
                For <strong className="text-foreground">{link.data.email}</strong>. You'll sign in
                with this email and password from now on.
              </>
            ) : (
              'Checking the link…'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            {/* Lets password managers save the right account. */}
            <input
              type="email"
              autoComplete="username"
              value={link.data?.email ?? ''}
              readOnly
              hidden
            />
            {needsCode ? (
              <>
                <Alert>
                  Password saved. Your account also uses an authenticator app: enter the 6-digit
                  code from it, or one of your recovery codes.
                </Alert>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="code">Authenticator code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                {signIn.isError && <Alert variant="destructive">{signIn.error.message}</Alert>}
                <Button type="submit" size="lg" disabled={signIn.isPending || !code.trim()}>
                  {signIn.isPending ? 'Signing in…' : 'Sign in'}
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={10}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="new-password-again">Type it again</Label>
                  <Input
                    id="new-password-again"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                    aria-invalid={mismatch}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
                {mismatch && <Alert variant="destructive">The two passwords don't match.</Alert>}
                {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
                <Button
                  type="submit"
                  size="lg"
                  disabled={
                    save.isPending || !link.data || password.length < 10 || password !== again
                  }
                >
                  {save.isPending ? 'Saving…' : 'Save password and sign in'}
                </Button>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
