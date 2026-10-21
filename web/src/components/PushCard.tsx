import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentSubscription, disablePush, enablePush, pushSupport } from '@/lib/push';

/**
 * Account → Notifications on this device: one switch per phone or computer. Rainouts, skipped
 * rounds, notices from admins, your foursome's news and LeagueMates' own notices pop up here.
 */
export function PushCard() {
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (support !== 'ready') return;
    let live = true;
    currentSubscription()
      .then((s) => live && setOn(Boolean(s)))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, [support]);

  const toggle = async (want: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (want) {
        const r = await enablePush();
        if (r === 'on') setOn(true);
        else if (r === 'denied')
          setNote(
            'Notifications are blocked for LeagueMates. Allow them in your browser or phone settings, then try again.',
          );
        else setNote("Push notifications aren't set up on this server yet.");
      } else {
        await disablePush();
        setOn(false);
      }
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications on this device</CardTitle>
        <CardDescription>
          Rainouts and skipped rounds, notices from your league's admins, news for your foursome
          (who can't make it, a card to check) and notices from LeagueMates. Turn it on for each
          phone or computer you use.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {support === 'ready' ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(on)}
              disabled={busy || on === null}
              onChange={(e) => void toggle(e.target.checked)}
            />
            Notify me on this device
          </label>
        ) : support === 'needs-home-screen' ? (
          <p className="text-muted-foreground">
            On iPhone, add LeagueMates to your home screen first: tap Share, then{' '}
            <span className="font-medium text-foreground">Add to Home Screen</span>. Open it from
            there and turn notifications on here.
          </p>
        ) : (
          <p className="text-muted-foreground">This browser can't show notifications.</p>
        )}
        {note && <p className="mt-2 text-destructive">{note}</p>}
      </CardContent>
    </Card>
  );
}
