import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ME_KEY, useMe, useSignOut } from '@/auth/session';
import { DetailsForm } from '@/components/DetailsForm';
import { SecurityCard } from '@/components/SecurityCard';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { PracticeScanCard } from '@/components/PracticeScanCard';
import { PushCard } from '@/components/PushCard';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function AccountPage() {
  const { data: me } = useMe();
  const [theme, setTheme] = useTheme();
  const signOut = useSignOut();
  const qc = useQueryClient();
  const saveDetails = useMutation({
    mutationFn: (d: {
      name: string | null;
      nickname: string | null;
      phone: string;
      address: string;
    }) => api('/me', { method: 'PATCH', body: d }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
  const saveEmails = useMutation({
    mutationFn: (noticeEmails: boolean) => api('/me', { method: 'PATCH', body: { noticeEmails } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
  const navigate = useNavigate();
  if (!me) return null;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            Signed in as {me.user.email}. Your league members can see these, so they can reach you
            about subs and rainouts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DetailsForm
            initial={{
              name: me.user.name,
              nickname: me.user.nickname ?? null,
              phone: me.user.phone ?? null,
              address: me.user.address ?? null,
            }}
            onSave={(d) => saveDetails.mutate(d)}
            saving={saveDetails.isPending}
            error={saveDetails.error?.message ?? null}
            saved={saveDetails.isSuccess}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>
            Rainouts, skipped rounds and notices an admin chooses to email. Sign-in and password
            emails always come.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveEmails.isPending ? saveEmails.variables : me.user.noticeEmails !== false}
              disabled={saveEmails.isPending}
              onChange={(e) => saveEmails.mutate(e.target.checked)}
            />
            Email me notices
          </label>
          {saveEmails.isError && (
            <p className="mt-2 text-sm text-destructive">{saveEmails.error.message}</p>
          )}
        </CardContent>
      </Card>
      <PushCard />
      <PracticeScanCard />
      <SecurityCard isAdmin={me.user.isSiteAdmin || me.leagues.some((l) => l.role === 'admin')} />
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label="Theme"
            className="inline-flex rounded-lg border bg-muted p-1"
          >
            {THEMES.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={theme === t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm text-muted-foreground',
                  theme === t.value && 'bg-card text-foreground shadow-xs',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => signOut.mutate(undefined, { onSettled: () => navigate('/sign-in') })}
      >
        <LogOut /> Sign out
      </Button>
    </div>
  );
}
