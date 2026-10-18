import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatPhone } from '@/lib/phone';
import { me, mockApi, renderAt } from './render';

describe('account details', () => {
  it('saves name, phone and address', async () => {
    let body: unknown;
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'PATCH /api/me': (init) => {
        body = JSON.parse(String(init?.body));
        return { status: 200, body: {} };
      },
    });
    renderAt('/account');
    await userEvent.type(await screen.findByLabelText('Phone'), '860 555 1234');
    await userEvent.type(screen.getByLabelText('Address'), '1 Golf Rd, Berlin CT');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(body).toEqual({
      name: 'Brian Brockel',
      nickname: null,
      phone: '860 555 1234',
      address: '1 Golf Rd, Berlin CT',
    });
  });

  it('turns notice emails off', async () => {
    let body: unknown;
    let noticeEmails = true;
    mockApi({
      'GET /api/auth/me': () => ({
        status: 200,
        body: { ...me, user: { ...me.user, noticeEmails } },
      }),
      'PATCH /api/me': (init) => {
        body = JSON.parse(String(init?.body));
        noticeEmails = false;
        return { status: 200, body: {} };
      },
    });
    renderAt('/account');
    const box = await screen.findByRole('checkbox', { name: 'Email me notices' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(body).toEqual({ noticeEmails: false });
    await waitFor(() => expect(box).not.toBeChecked());
  });
});

describe('contact links', () => {
  it('formats US numbers and links call, text and maps', async () => {
    expect(formatPhone('+18605551234')).toBe('(860) 555-1234');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
    const L = me.leagues[0]!.id;
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      [`GET /api/leagues/${L}`]: () => ({ status: 200, body: { ...me.leagues[0], role: 'user' } }),
      [`GET /api/leagues/${L}/seasons`]: () => ({ status: 200, body: [] }),
      [`GET /api/leagues/${L}/members`]: () => ({
        status: 200,
        body: {
          members: [
            {
              userId: 'u2',
              email: 'jerry@example.com',
              name: 'Jerry',
              phone: '+18605551234',
              address: '1 Golf Rd',
              role: 'user',
            },
          ],
          players: [],
        },
      }),
    });
    renderAt(`/leagues/${L}`);
    expect(await screen.findByRole('link', { name: '(860) 555-1234' })).toHaveAttribute(
      'href',
      'tel:+18605551234',
    );
    expect(screen.getByRole('link', { name: 'Text (860) 555-1234' })).toHaveAttribute(
      'href',
      'sms:+18605551234',
    );
    expect(screen.getByRole('link', { name: /1 Golf Rd/ }).getAttribute('href')).toContain(
      'maps.google.com',
    );
  });
});
