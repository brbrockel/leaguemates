import { Share, SquarePlus, X } from 'lucide-react';
import { useState } from 'react';

const KEY = 'teemate.installHint.dismissed';

/** An iPhone or iPad (iPadOS reports itself as a Mac, but with touch). */
export function isIos(nav: Navigator = navigator): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.userAgent.includes('Macintosh') && nav.maxTouchPoints > 1)
  );
}

/** Already opened from the Home Screen icon. */
function installed(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * iPhone and iPad only: Safari never offers to install a web app, so explain the two taps
 * (Android's Chrome offers it by itself). Shown until dismissed or installed.
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => !isIos() || installed() || dismissed());
  if (hidden) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Private browsing: it just shows again next time.
    }
    setHidden(true);
  };
  return (
    <section
      aria-label="Add LeagueMates to your Home Screen"
      className="flex items-start gap-3 rounded-xl border bg-card p-3 text-sm shadow-xs"
    >
      <img src="/apple-touch-icon-180x180.png" alt="" className="size-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Add LeagueMates to your Home Screen</p>
        <p className="text-muted-foreground">
          It opens like an app, full screen. In Safari, tap{' '}
          <Share className="inline size-4 align-text-bottom" aria-hidden /> Share, then{' '}
          <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> Add to Home Screen.
        </p>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Don't show again"
        className="rounded-md p-1 text-muted-foreground hover:bg-accent"
      >
        <X className="size-4" />
      </button>
    </section>
  );
}
