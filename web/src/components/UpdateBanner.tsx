import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

const HOUR = 60 * 60 * 1000;

/**
 * Registers the service worker and says when a new version of LeagueMates is ready. The app never
 * reloads itself for an update: that would throw away whatever someone is typing (a scorecard
 * mid-round). Reloading is their choice.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // An app left open all season still hears about updates.
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update().catch(() => {}), HOUR);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-lg md:bottom-4"
    >
      <span className="flex-1">A new version of LeagueMates is ready.</span>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        <RefreshCw /> Reload
      </Button>
    </div>
  );
}
