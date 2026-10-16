import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import { PASSWORD_HINT } from '@/pages/SetPasswordPage';

interface Security {
  hasPassword: boolean;
  passwordSetAt: string | null;
  totpEnabled: boolean;
  recoveryCodesLeft: number | null;
  totpAvailable: boolean;
}

const KEY = ['auth-security'];

/** Change your password, and turn authenticator codes on or off (optional, recommended for admins). */
export function SecurityCard({ isAdmin }: { isAdmin: boolean }) {
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Security>('/auth/security') });
  const s = q.data;
  if (!s) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden /> Security
        </CardTitle>
        <CardDescription>
          Changing your password signs you out on your other devices.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <PasswordForm hasPassword={s.hasPassword} />
        {s.totpAvailable && <Authenticator s={s} isAdmin={isAdmin} />}
      </CardContent>
    </Card>
  );
}

function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const save = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { current, password: next } }),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setAgain('');
      await qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">
        {hasPassword ? 'Change password' : 'Set a password'}
      </h3>
      {hasPassword && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pw-current">Current password</Label>
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pw-new">New password</Label>
          <Input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pw-again">Type it again</Label>
          <Input
            id="pw-again"
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
      {again && again !== next && (
        <Alert variant="destructive">The two passwords don't match.</Alert>
      )}
      {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
      {save.isSuccess && <Alert>Password changed. Your other devices are signed out.</Alert>}
      <Button
        type="submit"
        className="w-fit"
        disabled={save.isPending || next.length < 10 || next !== again}
      >
        <Check /> Save password
      </Button>
    </form>
  );
}

function Authenticator({ s, isAdmin }: { s: Security; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (setup) void QRCode.toDataURL(setup.url, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const start = useMutation({
    mutationFn: () => api<{ secret: string; url: string }>('/auth/totp/start', { method: 'POST' }),
    onSuccess: setSetup,
  });
  const enable = useMutation({
    mutationFn: () =>
      api<{ recoveryCodes: string[] }>('/auth/totp/enable', { method: 'POST', body: { code } }),
    onSuccess: async (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const disable = useMutation({
    mutationFn: () => api('/auth/totp/disable', { method: 'POST', body: { password } }),
    onSuccess: async () => {
      setPassword('');
      await qc.invalidateQueries({ queryKey: KEY });
    },
  });

  return (
    <div className="flex flex-col gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Authenticator app (optional)</h3>
      {codes && (
        <Alert>
          <p className="mb-2 font-medium">
            Save these recovery codes somewhere safe. Each one works once if you lose your phone.
            They won't be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      )}
      {s.totpEnabled ? (
        <>
          <p className="text-sm text-muted-foreground">
            On. Signing in asks for a code from your app.{' '}
            {s.recoveryCodesLeft !== null &&
              `${s.recoveryCodesLeft} recovery code${s.recoveryCodesLeft === 1 ? '' : 's'} left.`}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              disable.mutate();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp-off-pw">Password to turn it off</Label>
              <Input
                id="totp-off-pw"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={disable.isPending}>
              Turn off
            </Button>
          </form>
          {disable.isError && <Alert variant="destructive">{disable.error.message}</Alert>}
        </>
      ) : setup ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Scan this with Google Authenticator, Microsoft Authenticator, 1Password or similar, then
            enter the 6-digit code it shows.
          </p>
          {qr && (
            <img
              src={qr}
              alt="QR code for your authenticator app"
              className="size-48 rounded-md bg-white p-1"
            />
          )}
          <p className="break-all text-xs text-muted-foreground">
            Can't scan? Enter this key:{' '}
            <span className="font-mono text-foreground">{setup.secret}</span>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="totp-code">Code</Label>
              <Input
                id="totp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className="w-32"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={enable.isPending}>
              <Check /> Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
          {enable.isError && <Alert variant="destructive">{enable.error.message}</Alert>}
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Adds a 6-digit code from your phone when you sign in, so a password alone isn't enough.
            {isAdmin && ' Recommended for admins.'}
          </p>
          <Button
            variant="outline"
            className="w-fit"
            disabled={start.isPending || !s.hasPassword}
            onClick={() => start.mutate()}
          >
            Set up authenticator
          </Button>
          {!s.hasPassword && <p className="text-xs text-muted-foreground">Set a password first.</p>}
          {start.isError && <Alert variant="destructive">{start.error.message}</Alert>}
        </>
      )}
    </div>
  );
}
