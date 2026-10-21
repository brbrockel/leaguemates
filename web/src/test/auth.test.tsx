import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { api, setCsrfToken } from '@/lib/api';
import { emailOptions, me, mockApi, renderAt, signedOut } from './render';

describe('signed-out users', () => {
  it('are sent to the sign-in page', async () => {
    mockApi({ 'GET /api/auth/me': signedOut, 'GET /api/auth/options': emailOptions });
    const router = renderAt('/leagues/abc');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});

describe('sign-in page', () => {
  it('requests a link and says to check email', async () => {
    const calls = mockApi({
      'GET /api/auth/me': signedOut,
      'GET /api/auth/options': emailOptions,
      'POST /api/auth/magic-link': () => ({ status: 202, body: { ok: true } }),
    });
    renderAt('/sign-in');
    await userEvent.type(
      await screen.findByLabelText('Email me a sign-in link instead'),
      'brian@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    await screen.findByText('Check your email');
    const post = calls.find((c) => c.key === 'POST /api/auth/magic-link');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ email: 'brian@example.com' });
  });

  it('shows the rate-limit message', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'GET /api/auth/options': emailOptions,
      'POST /api/auth/magic-link': () => ({
        status: 429,
        body: { message: 'Too many sign-in attempts.' },
      }),
    });
    renderAt('/sign-in');
    await userEvent.type(
      await screen.findByLabelText('Email me a sign-in link instead'),
      'brian@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts.');
  });
});

describe('verify page', () => {
  it('signs in only after the button is pressed, then goes home', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /api/auth/me': () => (signedIn ? { status: 200, body: me } : signedOut()),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      'POST /api/auth/verify': () => {
        signedIn = true;
        return { status: 200, body: { user: me.user, csrfToken: me.csrfToken } };
      },
    });
    window.history.replaceState(null, '', '/sign-in/verify#token=abc123abc123abc123abc123');
    const router = renderAt('/sign-in/verify');

    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(calls.some((c) => c.key === 'POST /api/auth/verify')).toBe(false);
    expect(window.location.hash).toBe(''); // token removed from the address bar
    await userEvent.click(button);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await screen.findByRole('heading', { name: 'Hi, Brian' });
    const verify = calls.find((c) => c.key === 'POST /api/auth/verify');
    expect(JSON.parse(String(verify?.init?.body))).toEqual({ token: 'abc123abc123abc123abc123' });
  });

  it('explains a missing token', async () => {
    mockApi({ 'GET /api/auth/me': signedOut });
    window.history.replaceState(null, '', '/sign-in/verify');
    renderAt('/sign-in/verify');
    await screen.findByText(/missing its sign-in code/);
    expect(screen.getByRole('link', { name: 'Get a new link' })).toBeInTheDocument();
  });
});

describe('api client', () => {
  it('sends the CSRF token on state-changing requests only', async () => {
    const calls = mockApi({
      'GET /api/leagues': () => ({ status: 200, body: [] }),
      'POST /api/leagues': () => ({ status: 201, body: {} }),
    });
    setCsrfToken('csrf-xyz');
    await api('/leagues');
    await api('/leagues', { method: 'POST', body: { name: 'x' } });
    const headers = (i: number) => calls[i]!.init!.headers as Record<string, string>;
    expect(headers(0)['x-csrf-token']).toBeUndefined();
    expect(headers(1)['x-csrf-token']).toBe('csrf-xyz');
  });
});

describe('signed-in layout', () => {
  it('shows the leagues and a link to each', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    });
    renderAt('/');
    const links = await screen.findAllByRole('link', { name: /Wednesday League/ });
    expect(links[0]).toHaveAttribute('href', `/leagues/${me.leagues[0]!.id}`);
  });
});

describe('navigation', () => {
  it('has no Account tab; account is in the profile menu', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    });
    renderAt('/');
    await screen.findByRole('heading', { name: 'Hi, Brian' });
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: /Account/ })).toBeInTheDocument();
  });
});

describe('opening a sign-in link while already signed in', () => {
  it('does not use up the link and offers to continue', async () => {
    const calls = mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: me }) });
    window.history.replaceState(null, '', '/sign-in/verify#token=abc123abc123abc123abc123');
    renderAt('/sign-in/verify');
    expect(await screen.findByText("You're already signed in")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to LeagueMates' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(calls.some((c) => c.key === 'POST /api/auth/verify')).toBe(false);
  });
});

describe('password sign-in', () => {
  it('asks for the authenticator code when the account has one, then goes home', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /api/auth/me': () => (signedIn ? { status: 200, body: me } : signedOut()),
      'GET /api/auth/options': () => ({
        status: 200,
        body: { testLogin: false, emailSignIn: false, passwordSignIn: true },
      }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      'POST /api/auth/login': (init) => {
        const body = JSON.parse(String(init?.body));
        if (!body.code) return { status: 200, body: { needsCode: true } };
        signedIn = true;
        return { status: 200, body: { user: me.user, csrfToken: me.csrfToken } };
      },
    });
    const router = renderAt('/sign-in');
    await userEvent.type(await screen.findByLabelText('Email'), 'brian@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'four fairways and a green');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const logins = calls.filter((c) => c.key === 'POST /api/auth/login');
    expect(JSON.parse(String(logins[1]?.init?.body))).toEqual({
      email: 'brian@example.com',
      password: 'four fairways and a green',
      code: '123456',
    });
  });
});

describe('set password page', () => {
  it('shows who the link is for and needs the password typed twice', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /api/auth/me': () => (signedIn ? { status: 200, body: me } : signedOut()),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      'POST /api/auth/password-link/check': () => ({
        status: 200,
        body: { email: 'jerry@example.com', name: 'Jerry', hasPassword: false },
      }),
      'POST /api/auth/password-link': () => {
        signedIn = true;
        return { status: 200, body: { user: me.user, csrfToken: me.csrfToken } };
      },
    });
    window.history.replaceState(null, '', '/set-password#token=abc123abc123abc123abc123');
    const router = renderAt('/set-password');
    expect(await screen.findByText('jerry@example.com')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    const save = screen.getByRole('button', { name: /Save password/ });
    await userEvent.type(screen.getByLabelText('New password'), 'four fairways and a green');
    await userEvent.type(screen.getByLabelText('Type it again'), 'four fairways and a gree');
    expect(screen.getByText("The two passwords don't match.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type it again'), 'n');
    await userEvent.click(save);
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const post = calls.find((c) => c.key === 'POST /api/auth/password-link');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      token: 'abc123abc123abc123abc123',
      password: 'four fairways and a green',
    });
  });

  it('asks for an authenticator code after saving when the account has one', async () => {
    let signedIn = false;
    const calls = mockApi({
      'GET /api/auth/me': () => (signedIn ? { status: 200, body: me } : signedOut()),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      'POST /api/auth/password-link/check': () => ({
        status: 200,
        body: { email: 'jerry@example.com', name: 'Jerry', hasPassword: true },
      }),
      'POST /api/auth/password-link': () => ({ status: 200, body: { needsCode: true } }),
      'POST /api/auth/login': () => {
        signedIn = true;
        return { status: 200, body: { user: me.user, csrfToken: me.csrfToken } };
      },
    });
    window.history.replaceState(null, '', '/set-password#token=abc123abc123abc123abc123');
    const router = renderAt('/set-password');
    await screen.findByText('jerry@example.com');
    await userEvent.type(screen.getByLabelText('New password'), 'four fairways and a green');
    await userEvent.type(screen.getByLabelText('Type it again'), 'four fairways and a green');
    await userEvent.click(screen.getByRole('button', { name: /Save password/ }));
    await userEvent.type(await screen.findByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const login = calls.find((c) => c.key === 'POST /api/auth/login');
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: 'jerry@example.com',
      password: 'four fairways and a green',
      code: '123456',
    });
  });
});
