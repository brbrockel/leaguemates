import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ME_KEY, useMe } from '@/auth/session';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { AnnouncementsCard } from '@/components/AnnouncementsCard';
import { ThisWeek } from '@/components/ThisWeekCard';
import { useCurrentLeague } from '@/lib/useCurrentLeague';
import { api } from '@/lib/api';

export function HomePage() {
  const { data: me } = useMe();
  const league = useCurrentLeague();
  if (!me) return null;
  const firstName = me.user.name?.split(' ')[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Hi, ${firstName}` : 'Welcome'}
        </h1>
        <p className="text-sm text-muted-foreground">Your next round, scores and standings.</p>
      </div>

      <ThisWeek />

      {league && <AnnouncementsCard leagueId={league.id} compact />}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Your leagues</h2>
        {me.leagues.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No leagues yet</CardTitle>
              <CardDescription>
                {me.user.isSiteAdmin
                  ? 'Create the first league below.'
                  : "You're not in a league yet. When a league admin adds you, it shows up here."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {me.leagues.map((l) => (
              <Link key={l.id} to={`/leagues/${l.id}`} className="group">
                <Card className="flex items-center justify-between p-5 transition-colors group-hover:bg-accent/50">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{l.name}</span>
                    <Badge className="w-fit capitalize">
                      {l.role === 'viewer' ? 'Public · viewing' : l.role}
                    </Badge>
                  </div>
                  <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {me.user.isSiteAdmin && me.leagues.length === 0 && <CreateLeagueCard />}
    </div>
  );
}

export function CreateLeagueCard() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/leagues', { method: 'POST', body: { name } }),
    onSuccess: async () => {
      setName('');
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a league</CardTitle>
        <CardDescription>Site admins only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="league-name">League name</Label>
            <Input
              id="league-name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wednesday League"
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            <Plus /> Create
          </Button>
        </form>
        {create.isError && (
          <Alert variant="destructive" className="mt-3">
            {create.error.message}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
