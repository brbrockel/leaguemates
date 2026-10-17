import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FlaskConical, MailCheck, X, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ME_KEY, useMe } from '@/auth/session';
import { Logo } from '@/components/logo';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api, ApiError, setCsrfToken, type AuthOptions, type Me, type User } from '@/lib/api';
import { forgetEmail, recentEmails, rememberEmail, saveCode, savedCode } from '@/lib/testLogin';

export function SignInPage() {
  const me = useMe();
  const options = useQuery({
    queryKey: ['auth-options'],
    queryFn: () => api<AuthOptions>('/auth/options'),
    staleTime: 60_000,
  });

  if (me.data) return <Navigate to="/" replace />;
  if (!options.data) return <AuthShell>{null}</AuthShell>;
  const { testLogin, emailSignIn, guests } = options.data;

  return (
    <AuthShell>
      <div className="flex flex-col gap-4">
        <PasswordSignInCard />
        {testLogin && <TestSignInCard />}
        {emailSignIn && <EmailLinkCard compact />}
        {guests && <GuestButton />}
      </div>
    </AuthShell>
  );
}

/** No account: look around read-only (schedules, scores and stats by nickname). */
function GuestButton() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const look = useMutation({
    mutationFn: () => api<Me>('/auth/guest', { method: 'POST' }),
    onSuccess: (me) => {
      setCsrfToken(me.csrfToken);
      qc.setQueryData(ME_KEY, me);
      navigate('/', { replace: true });
    },
  });
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Button variant="outline" disabled={look.isPending} onClick={() => look.mutate()}>
        <Eye /> Look around as a guest
      </Button>
      <p className="text-xs text-muted-foreground">
        See schedules, results and stats. Players show by nickname only, and nothing can be changed.
      </p>
      {look.isError && <Alert variant="destructive">{look.error.message}</Alert>}
    </div>
  );
}

/** Email and password, then an authenticator code if the account has one. */
function PasswordSignInCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);

  const signIn = useMutation({
    mutationFn: () =>
      api<{ user: User; csrfToken: string } | { needsCode: true }>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(needsCode ? { code } : {}) },
      }),
    onSuccess: async (r) => {
      if ('needsCode' in r) {
        setNeedsCode(true);
        return;
      }
      setCsrfToken(r.csrfToken);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {needsCode
            ? 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.'
            : 'With your email and TeeMate password.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {needsCode ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="signin-code">Code</Label>
              <Input
                id="signin-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signin-password">Password</Label>
                <Input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          )}
          {signIn.isError && <Alert variant="destructive">{signIn.error.message}</Alert>}
          <Button type="submit" size="lg" disabled={signIn.isPending}>
            {signIn.isPending ? 'Signing in…' : needsCode ? 'Verify' : 'Sign in'}
          </Button>
          {needsCode ? (
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => {
                setNeedsCode(false);
                setCode('');
              }}
            >
              Back
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              New, or forgot your password? Ask a league admin for a password link. It works once
              and lets you set a new password.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** Testing mode: one tap for accounts used on this device, or any email + the access code. */
function TestSignInCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [recents, setRecents] = useState(recentEmails);
  const [code, setCode] = useState(savedCode);
  const [editingCode, setEditingCode] = useState(!savedCode());
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const signIn = useMutation({
    mutationFn: (target: { email: string; name?: string }) =>
      api<{ user: User; csrfToken: string }>('/auth/test-login', {
        method: 'POST',
        body: { email: target.email, code, ...(target.name?.trim() ? { name: target.name } : {}) },
      }),
    onSuccess: async ({ user, csrfToken }) => {
      setCsrfToken(csrfToken);
      saveCode(code);
      rememberEmail(user.email);
      await qc.invalidateQueries({ queryKey: ME_KEY });
      navigate('/', { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        saveCode(null);
        setEditingCode(true);
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate({ email, name });
  };

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5 text-amber-600 dark:text-amber-400" aria-hidden /> Testing
          mode
        </CardTitle>
        <CardDescription>
          Sign in instantly with the test access code. New emails get a user account in the test
          league.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recents.length > 0 && !editingCode && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">On this device</span>
            {recents.map((r) => (
              <div key={r} className="flex items-center gap-1">
                <Button
                  variant="outline"
                  className="flex-1 justify-start"
                  disabled={signIn.isPending}
                  onClick={() => signIn.mutate({ email: r })}
                >
                  <Zap className="text-primary" /> <span className="truncate">{r}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Forget ${r}`}
                  onClick={() => {
                    forgetEmail(r);
                    setRecents(recentEmails());
                  }}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-email">
              {recents.length ? 'Another test email' : 'Test account email'}
            </Label>
            <Input
              id="test-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-name">Name (new accounts)</Label>
            <Input
              id="test-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {editingCode ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="test-code">Test access code</Label>
              <Input
                id="test-code"
                type="password"
                autoComplete="off"
                autoCapitalize="characters"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="TEE-0000-0000"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Access code saved on this device.{' '}
              <button type="button" className="underline" onClick={() => setEditingCode(true)}>
                Change
              </button>
            </p>
          )}
          {signIn.isError && <Alert variant="destructive">{signIn.error.message}</Alert>}
          <Button type="submit" size="lg" disabled={signIn.isPending || !code}>
            <Zap /> {signIn.isPending ? 'Signing in…' : 'Sign in now'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailLinkCard({ compact }: { compact: boolean }) {
  const [email, setEmail] = useState('');
  const request = useMutation({
    mutationFn: (address: string) =>
      api<{ ok: true }>('/auth/magic-link', { method: 'POST', body: { email: address } }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    request.mutate(email);
  };

  if (request.isSuccess) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <MailCheck className="mb-2 size-10 text-primary" aria-hidden />
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If <strong className="text-foreground">{email.trim()}</strong> is in a TeeMate league, a
            sign-in link is on its way. It works once and expires in 15 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button variant="link" onClick={() => request.reset()}>
            Use a different email
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{compact ? 'Or get an email link' : 'Sign in'}</CardTitle>
        <CardDescription>We'll email you a link. No password needed.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email me a sign-in link instead</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {request.isError && <Alert variant="destructive">{request.error.message}</Alert>}
          <Button
            type="submit"
            size="lg"
            variant={compact ? 'outline' : 'default'}
            disabled={request.isPending}
          >
            {request.isPending ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <Logo className="size-11" />
        <span className="text-2xl font-semibold tracking-tight">TeeMate</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
