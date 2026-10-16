import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from '@/router';

type Handler = (init: RequestInit | undefined) => { status: number; body?: unknown };

/** Stubs fetch with handlers keyed by "METHOD /api/path"; unmatched requests fail the test. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push({ key, init });
      const handler = handlers[key];
      if (!handler) throw new Error(`Unexpected request: ${key}`);
      const { status, body } = handler(init);
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

export const emailOptions = () => ({ status: 200, body: { testLogin: false, emailSignIn: true } });
export const testOptions = () => ({ status: 200, body: { testLogin: true, emailSignIn: false } });

export const signedOut = () => ({ status: 401, body: { message: 'Sign in to continue.' } });

export const me = {
  user: { id: 'u1', email: 'brian@example.com', name: 'Brian Brockel', isSiteAdmin: false },
  csrfToken: 'csrf-123',
  leagues: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Wednesday League',
      slug: 'wednesday-league',
      role: 'admin',
    },
  ],
};
