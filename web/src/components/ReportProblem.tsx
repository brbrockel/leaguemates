import { useMutation } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';

const textarea =
  'w-full rounded-lg border bg-card px-3 py-2 text-base shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm';

/**
 * "Report a problem": files a public GitHub issue for the developers (signed with the
 * person's nickname or first name), with the page they were on. No GitHub account needed.
 */
export function ReportProblemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const [title, setTitle] = useState('');
  const [happened, setHappened] = useState('');
  const [expected, setExpected] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api<{ issueUrl: string | null; issueNumber: number | null }>('/bug-reports', {
        method: 'POST',
        body: { title, happened, expected: expected || undefined, page: pathname },
      }),
  });
  const close = () => {
    onClose();
    if (send.isSuccess) {
      setTitle('');
      setHappened('');
      setExpected('');
      send.reset();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Report a problem"
        description="It goes to the people who build LeagueMates as a public GitHub issue, signed with your nickname (or first name). Please leave out phone numbers, emails and other personal details."
      >
        {send.isSuccess ? (
          <div className="flex flex-col gap-3">
            <Alert>
              Thanks! Your report was sent
              {send.data.issueNumber ? ` as issue #${send.data.issueNumber}` : ''}.
            </Alert>
            <div className="flex flex-wrap gap-3">
              {send.data.issueUrl && (
                <Button asChild variant="outline">
                  <a href={send.data.issueUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> See it on GitHub
                  </a>
                </Button>
              )}
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bug-title">In a few words</Label>
              <Input
                id="bug-title"
                required
                minLength={3}
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Scores disappear after saving"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bug-happened">What happened?</Label>
              <textarea
                id="bug-happened"
                required
                rows={4}
                maxLength={4000}
                value={happened}
                onChange={(e) => setHappened(e.target.value)}
                className={textarea}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bug-expected">What did you expect? (optional)</Label>
              <textarea
                id="bug-expected"
                rows={2}
                maxLength={2000}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                className={textarea}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Sent with the page you're on ({pathname}), the app version and your browser.
            </p>
            {send.isError && <Alert variant="destructive">{send.error.message}</Alert>}
            <Button
              type="submit"
              className="w-fit"
              disabled={send.isPending || title.trim().length < 3 || !happened.trim()}
            >
              {send.isPending ? 'Sending…' : 'Send report'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
