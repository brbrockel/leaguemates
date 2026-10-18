import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { me, mockApi, renderAt } from './render';

describe('report a problem', () => {
  it('the profile menu shows the version that is running', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('TeeMate 1.1.0 (dev)')).toBeInTheDocument();
  });

  it('sends a report from the profile menu with the current page', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me }),
      'GET /api/me/this-week': () => ({ status: 200, body: [] }),
      'POST /api/bug-reports': () => ({
        status: 201,
        body: { id: 'b1', issueNumber: 7, issueUrl: 'https://github.com/x/y/issues/7' },
      }),
    });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Report a problem/ }));
    expect(screen.getByText(/public GitHub issue, signed with your nickname/)).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('In a few words'), 'Scores vanish');
    await userEvent.type(screen.getByLabelText('What happened?'), 'Hole 3 went blank');
    await userEvent.click(send);
    expect(await screen.findByText(/sent as issue #7/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See it on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/x/y/issues/7',
    );
    const post = calls.find((c) => c.key === 'POST /api/bug-reports');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      title: 'Scores vanish',
      happened: 'Hole 3 went blank',
      page: '/',
    });
  });
});
