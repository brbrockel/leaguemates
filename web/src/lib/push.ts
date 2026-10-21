import { api } from '@/lib/api';

/** Where this browser stands with push notifications. */
export type PushSupport =
  | 'ready'
  /** iPhone or iPad in Safari: push only works once LeagueMates is on the home screen. */
  | 'needs-home-screen'
  | 'unsupported';

export function pushSupport(): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)
    return 'ready';
  return ios && !standalone ? 'needs-home-screen' : 'unsupported';
}

/** This browser's push subscription, if push is on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks permission, subscribes this browser and tells the server. Returns why it couldn't. */
export async function enablePush(): Promise<'on' | 'denied' | 'not-set-up'> {
  const { publicKey } = await api<{ publicKey: string | null }>('/push/key');
  if (!publicKey) return 'not-set-up';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api('/push/subscriptions', { method: 'POST', body: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
