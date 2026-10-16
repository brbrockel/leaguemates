import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { me, mockApi, renderAt, signedOut, testOptions } from './render';

beforeEach(() => localStorage.clear());

function testApi(
  onLogin: (body: { email: string; code: string; name?: string }) => number = () => 200,
) {
  let signedIn = false;
  const calls = mockApi({
    'GET /api/auth/me': () => (signedIn ? { status: 200, body: me } : signedOut()),
    'GET /api/auth/options': testOptions,
    'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    'POST /api/auth/test-login': (init) => {
      const body = JSON.parse(String(init?.body));
      const status = onLogin(body);
      if (status !== 200)
        return { status, body: { message: 'That test access code is not right.' } };
      signedIn = true;
      return { status: 200, body: { user: { ...me.user, email: body.email }, csrfToken: 'c' } };
    },
  });
  return calls;
}

describe('testing mode sign-in', () => {
  it('hides the email form when email is off, and signs in with email + code', async () => {
    const calls = testApi();
    const router = renderAt('/sign-in');
    await userEvent.type(
      await screen.findByLabelText('Test account email'),
      'test.user@example.com',
    );
    await userEvent.type(screen.getByLabelText('Test access code'), 'TEE-1234-5678');
    expect(
      screen.queryByRole('button', { name: /Email me a sign-in link/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Sign in now/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const login = calls.find((c) => c.key === 'POST /api/auth/test-login');
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: 'test.user@example.com',
      code: 'TEE-1234-5678',
    });
    expect(localStorage.getItem('teemate-test-code')).toBe('TEE-1234-5678');
  });

  it('remembers accounts on this device for one-tap sign-in', async () => {
    localStorage.setItem('teemate-test-code', 'TEE-1234-5678');
    localStorage.setItem(
      'teemate-test-emails',
      JSON.stringify(['test.admin@example.com', 'test.user@example.com']),
    );
    const calls = testApi();
    const router = renderAt('/sign-in');
    await userEvent.click(await screen.findByRole('button', { name: 'test.admin@example.com' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const login = calls.find((c) => c.key === 'POST /api/auth/test-login');
    expect(JSON.parse(String(login?.init?.body))).toEqual({
      email: 'test.admin@example.com',
      code: 'TEE-1234-5678',
    });
  });

  it('a wrong code forgets the saved code and asks again', async () => {
    localStorage.setItem('teemate-test-code', 'OLD-CODE-0000');
    localStorage.setItem('teemate-test-emails', JSON.stringify(['test.user@example.com']));
    testApi(() => 401);
    renderAt('/sign-in');
    await userEvent.click(await screen.findByRole('button', { name: 'test.user@example.com' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(screen.getByLabelText('Test access code')).toBeInTheDocument();
    expect(localStorage.getItem('teemate-test-code')).toBeNull();
  });
});

describe('site settings', () => {
  const siteAdmin = { ...me, user: { ...me.user, isSiteAdmin: true } };
  const mail = {
    source: 'server',
    mode: 'off',
    allowlist: '',
    host: 'localhost',
    port: 11025,
    secure: false,
    user: null,
    hasPassword: false,
    from: 'TeeMate <teemate@test>',
    canStorePassword: true,
  };
  const view = (over = {}) => ({
    mailMode: 'off',
    mail,
    testLogin: { enabled: false, active: false, hasCode: false, leagueId: null, ...over },
  });

  it('generates a code, shows it once, then turns testing mode on', async () => {
    let state = view();
    const bodies: unknown[] = [];
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: siteAdmin }),
      'GET /api/site-settings': () => ({ status: 200, body: state }),
      'PUT /api/site-settings/test-login': (init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (body.generateCode) {
          state = view({ hasCode: true });
          return { status: 200, body: { ...state, code: 'TEE-4827-9315' } };
        }
        state = view({ hasCode: true, enabled: body.enabled, active: body.enabled });
        return { status: 200, body: state };
      },
      'GET /api/auth/options': testOptions,
    });
    renderAt('/site-settings');
    expect(await screen.findByRole('button', { name: /Turn testing mode on/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Generate a code/ }));
    expect(await screen.findByText('TEE-4827-9315')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Turn testing mode on/ }));
    expect(
      await screen.findByRole('button', { name: /Turn testing mode off/ }),
    ).toBeInTheDocument();
    expect(bodies).toEqual([{ generateCode: true }, { enabled: true }]);
  });

  it('saves Gmail settings (password write-only) and sends a test email', async () => {
    let state = view();
    const bodies: Record<string, unknown>[] = [];
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: siteAdmin }),
      'GET /api/site-settings': () => ({ status: 200, body: state }),
      'PUT /api/site-settings/mail': (init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        state = {
          ...state,
          mail: { ...mail, ...body, source: 'site', hasPassword: true, password: undefined },
        };
        return { status: 200, body: state };
      },
      'POST /api/site-settings/mail/test': () => ({
        status: 200,
        body: { ok: true, to: 'brian@example.com' },
      }),
    });
    renderAt('/site-settings');
    await userEvent.selectOptions(await screen.findByLabelText('Who gets email'), 'allowlist');
    await userEvent.type(screen.getByLabelText('Allowed addresses'), 'brian@example.com');
    await userEvent.clear(screen.getByLabelText('Mail server'));
    await userEvent.type(screen.getByLabelText('Mail server'), 'smtp.gmail.com');
    await userEvent.clear(screen.getByLabelText('Port'));
    await userEvent.type(screen.getByLabelText('Port'), '465');
    await userEvent.selectOptions(screen.getByLabelText('Security'), 'ssl');
    await userEvent.type(screen.getByLabelText('Username'), 'brian@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'abcd efgh ijkl mnop');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({
      mode: 'allowlist',
      allowlist: 'brian@example.com',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'brian@example.com',
      password: 'abcd efgh ijkl mnop',
    });
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'placeholder',
      'Saved (type to replace)',
    );
    await userEvent.click(screen.getByRole('button', { name: /Send me a test email/ }));
    expect(await screen.findByText(/Test email sent to brian@example.com/)).toBeInTheDocument();
  });

  it('is hidden from people who are not site admins', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: me }) });
    renderAt('/site-settings');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });
});
