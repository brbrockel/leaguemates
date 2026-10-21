import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderAt } from './render';

const endpoint = 'https://push.example.com/this-phone';

/** A browser that can do push: a service worker, PushManager and Notification. */
function pushCapable(permission: NotificationPermission = 'granted') {
  let sub: { endpoint: string; toJSON(): object; unsubscribe(): Promise<boolean> } | null = null;
  const subscription = {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => {
      sub = null;
      return true;
    },
  };
  const pushManager = {
    getSubscription: async () => sub,
    subscribe: vi.fn(async () => (sub = subscription)),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { requestPermission: async () => permission });
  return pushManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe('push notifications on Account', () => {
  it('turns them on and off for this device', async () => {
    const pm = pushCapable();
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/push/key': () => ({ status: 200, body: { publicKey: 'BKey_-12' } }),
      'POST /api/push/subscriptions': () => ({ status: 200, body: { ok: true } }),
      'DELETE /api/push/subscriptions': () => ({ status: 200, body: { ok: true } }),
    });
    renderAt('/account');
    const box = await screen.findByRole('checkbox', { name: 'Notify me on this device' });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();

    await userEvent.click(box);
    await waitFor(() => expect(box).toBeChecked());
    expect(pm.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const post = calls.find((c) => c.key === 'POST /api/push/subscriptions');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      endpoint,
      keys: { p256dh: 'p', auth: 'a' },
    });

    await userEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    const del = calls.find((c) => c.key === 'DELETE /api/push/subscriptions');
    expect(JSON.parse(String(del?.init?.body))).toEqual({ endpoint });
  });

  it('says so when notifications are blocked', async () => {
    pushCapable('denied');
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/push/key': () => ({ status: 200, body: { publicKey: 'BKey_-12' } }),
    });
    renderAt('/account');
    const box = await screen.findByRole('checkbox', { name: 'Notify me on this device' });
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    expect(
      await screen.findByText(/Notifications are blocked for LeagueMates/),
    ).toBeInTheDocument();
    expect(box).not.toBeChecked();
  });

  it("explains a browser that can't", async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: me }) });
    renderAt('/account');
    expect(await screen.findByText("This browser can't show notifications.")).toBeInTheDocument();
  });
});
