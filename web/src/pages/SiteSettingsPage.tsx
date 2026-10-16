import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bug,
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Mail,
  Power,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, type MailMode, type MailSettingsView, type SiteSettingsView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CreateLeagueCard } from './HomePage';
import { NotFoundPage } from './NotFoundPage';

const KEY = ['site-settings'];

export function SiteSettingsPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => api<SiteSettingsView>('/site-settings'),
    enabled: Boolean(me?.user.isSiteAdmin),
  });
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [ownCode, setOwnCode] = useState('');
  const [copied, setCopied] = useState(false);

  const update = useMutation({
    mutationFn: (body: object) =>
      api<SiteSettingsView>('/site-settings/test-login', { method: 'PUT', body }),
    onSuccess: async (view) => {
      if (view.code) {
        setShownCode(view.code);
        setCopied(false);
        setOwnCode('');
      }
      qc.setQueryData(KEY, { ...view, code: undefined });
      await qc.invalidateQueries({ queryKey: ['auth-options'] });
    },
  });

  if (!me?.user.isSiteAdmin) return <NotFoundPage />;
  if (!settings.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const t = settings.data.testLogin;
  const mailAll = settings.data.mailMode === 'all';
  const setOwn = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ code: ownCode });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Site settings</h1>
        <p className="text-sm text-muted-foreground">Site admins only. Changes are logged.</p>
      </div>

      <Card className={cn(t.active && 'border-amber-500/50')}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />{' '}
              Testing mode
            </CardTitle>
            <Badge
              className={cn(t.active ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : '')}
            >
              {t.active ? 'On' : 'Off'}
            </Badge>
          </div>
          <CardDescription>
            Shows a “Sign in now” option on the sign-in page. Anyone with the access code can sign
            in as any email; new emails become users in the test league (never admins). Turn it off
            before the league goes live.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {mailAll && (
            <Alert variant="destructive">
              Email goes to everyone, so testing mode can't be used. Change Email below first.
            </Alert>
          )}

          <Button
            variant={t.enabled ? 'outline' : 'default'}
            className="w-fit"
            disabled={update.isPending || mailAll || (!t.enabled && !t.hasCode)}
            onClick={() => update.mutate({ enabled: !t.enabled })}
          >
            <Power /> {t.enabled ? 'Turn testing mode off' : 'Turn testing mode on'}
          </Button>
          {!t.hasCode && (
            <p className="-mt-3 text-xs text-muted-foreground">Set an access code first.</p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="test-league">New test accounts join</Label>
            <Select
              id="test-league"
              value={t.leagueId ?? ''}
              onChange={(e) => update.mutate({ leagueId: e.target.value || null })}
            >
              <option value="">No league</option>
              {me.leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="size-4" aria-hidden /> Access code
              <span className="font-normal text-muted-foreground">
                {t.hasCode ? '(set)' : '(not set)'}
              </span>
            </div>
            {shownCode && (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <span className="text-xs text-muted-foreground">
                  New code. Share it with your testers; it won't be shown again.
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-lg font-semibold tracking-wider">{shownCode}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(shownCode);
                      setCopied(true);
                    }}
                  >
                    {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}
            <Button
              variant="secondary"
              className="w-fit"
              disabled={update.isPending}
              onClick={() => update.mutate({ generateCode: true })}
            >
              <RefreshCw /> {t.hasCode ? 'Generate a new code' : 'Generate a code'}
            </Button>
            <form onSubmit={setOwn} className="flex gap-2">
              <Input
                aria-label="Your own access code"
                minLength={8}
                value={ownCode}
                onChange={(e) => setOwnCode(e.target.value)}
                placeholder="Or type your own (8+ characters)"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={update.isPending || ownCode.trim().length < 8}
              >
                Set
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Changing the code signs nobody out, but the old code stops working for new sign-ins.
            </p>
          </div>

          {update.isError && <Alert variant="destructive">{update.error.message}</Alert>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Every change across all leagues and accounts, with who made it and when.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/activity">Open activity</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <CardDescription>
            Courses are shared by every league. Edit par, stroke index and yardages, or add a
            course.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/courses">Open courses</Link>
          </Button>
        </CardContent>
      </Card>

      <CreateLeagueCard />

      <EmailCard
        mail={settings.data.mail}
        onSaved={(view) => qc.setQueryData(KEY, view)}
        testLocked={t.enabled}
      />

      <BugReportsCard />
    </div>
  );
}

interface BugReportRow {
  id: string;
  title: string;
  happened: string;
  page: string | null;
  issueNumber: number | null;
  issueUrl: string | null;
  issueError: string | null;
  createdAt: string;
  reporterName: string | null;
  reporterEmail: string | null;
}

/** Problems people reported, with who sent them (the public issue only has their nickname). */
function BugReportsCard() {
  const reports = useQuery({
    queryKey: ['bug-reports'],
    queryFn: () => api<BugReportRow[]>('/bug-reports'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="size-5 text-primary" aria-hidden /> Problem reports
        </CardTitle>
        <CardDescription>
          From “Report a problem” in the profile menu. Each is filed as a GitHub issue; this list
          also shows who sent it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!reports.data?.length ? (
          <p className="text-sm text-muted-foreground">
            {reports.isLoading ? 'Loading…' : 'No reports yet.'}
          </p>
        ) : (
          <ul className="divide-y">
            {reports.data.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{r.title}</span>
                  {r.issueUrl ? (
                    <a
                      href={r.issueUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 text-primary hover:underline"
                    >
                      #{r.issueNumber} <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-destructive" title={r.issueError ?? ''}>
                      Not on GitHub
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {r.reporterName ?? r.reporterEmail ?? 'Someone'} ·{' '}
                  {new Date(r.createdAt).toLocaleString()} {r.page && `· ${r.page}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const MODES: { value: MailMode; label: string }[] = [
  { value: 'off', label: 'Off: no email to anyone' },
  { value: 'allowlist', label: 'Allowlist: only the addresses below' },
  { value: 'all', label: 'Everyone' },
];

/**
 * Outgoing email: who may get it (the guard) and the mail server. Saved here, it replaces
 * the server's settings. The password is write-only.
 */
function EmailCard({
  mail,
  onSaved,
  testLocked,
}: {
  mail: MailSettingsView;
  onSaved: (view: SiteSettingsView) => void;
  testLocked: boolean;
}) {
  const [form, setForm] = useState({
    mode: mail.mode,
    allowlist: mail.allowlist,
    host: mail.host,
    port: String(mail.port),
    secure: mail.secure,
    user: mail.user ?? '',
    from: mail.from,
  });
  const [password, setPassword] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      api<SiteSettingsView>('/site-settings/mail', {
        method: 'PUT',
        body: {
          ...form,
          port: Number(form.port),
          user: form.user.trim() || null,
          ...(password ? { password } : {}),
        },
      }),
    onSuccess: (view) => {
      setPassword('');
      onSaved(view);
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; to: string; error?: string }>('/site-settings/mail/test', {
        method: 'POST',
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      form.mode === 'all' &&
      mail.mode !== 'all' &&
      !window.confirm('Send email to everyone, including league members?')
    )
      return;
    save.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-5 text-primary" aria-hidden /> Email
          </CardTitle>
          <Badge className={cn(mail.mode === 'all' && 'bg-primary/15 text-primary')}>
            {MODES.find((m) => m.value === mail.mode)?.label.split(':')[0]}
          </Badge>
        </div>
        <CardDescription>
          Sign-in links and notices.{' '}
          {mail.source === 'server'
            ? "Using the server's settings until you save these."
            : 'Saved here; these replace the server settings.'}{' '}
          For Gmail: smtp.gmail.com, port 465 with SSL, your Gmail address and an app password
          (myaccount.google.com/apppasswords).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-mode">Who gets email</Label>
            <Select
              id="mail-mode"
              value={form.mode}
              onChange={(e) => set({ mode: e.target.value as MailMode })}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value} disabled={m.value === 'all' && testLocked}>
                  {m.label}
                  {m.value === 'all' && testLocked ? ' (turn testing mode off first)' : ''}
                </option>
              ))}
            </Select>
          </div>
          {form.mode === 'allowlist' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-allowlist">Allowed addresses</Label>
              <Input
                id="mail-allowlist"
                value={form.allowlist}
                onChange={(e) => set({ allowlist: e.target.value })}
                placeholder="you@gmail.com, *@example.com"
              />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-host">Mail server</Label>
              <Input
                id="mail-host"
                required
                value={form.host}
                onChange={(e) => set({ host: e.target.value })}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-port">Port</Label>
              <Input
                id="mail-port"
                inputMode="numeric"
                required
                value={form.port}
                onChange={(e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-secure">Security</Label>
              <Select
                id="mail-secure"
                value={form.secure ? 'ssl' : 'starttls'}
                onChange={(e) => set({ secure: e.target.value === 'ssl' })}
              >
                <option value="ssl">SSL (465)</option>
                <option value="starttls">STARTTLS (587)</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-user">Username</Label>
              <Input
                id="mail-user"
                autoComplete="off"
                value={form.user}
                onChange={(e) => set({ user: e.target.value })}
                placeholder="you@gmail.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mail-password">Password</Label>
              <Input
                id="mail-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!mail.canStorePassword}
                placeholder={mail.hasPassword ? 'Saved (type to replace)' : 'App password'}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mail-from">From</Label>
            <Input
              id="mail-from"
              required
              value={form.from}
              onChange={(e) => set({ from: e.target.value })}
              placeholder="TeeMate <you@gmail.com>"
            />
          </div>
          {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
          {test.data && (
            <Alert variant={test.data.ok ? 'default' : 'destructive'}>
              {test.data.ok
                ? `Test email sent to ${test.data.to}. Check that inbox (and spam).`
                : `The mail server said: ${test.data.error}`}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending || save.isPending}
              onClick={() => test.mutate()}
            >
              <Send /> {test.isPending ? 'Sending…' : 'Send me a test email'}
            </Button>
            {save.isSuccess && <span className="text-sm text-primary">Saved</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            The test email goes only to you, with the saved settings, whatever “Who gets email”
            says.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
