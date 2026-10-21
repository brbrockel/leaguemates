import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallHint, isIos } from '@/components/InstallHint';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const as = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('add to Home Screen hint', () => {
  it('tells iPhone users how, until they dismiss it', async () => {
    as(IPHONE);
    const { unmount } = render(<InstallHint />);
    expect(screen.getByText('Add LeagueMates to your Home Screen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Don't show again" }));
    expect(screen.queryByText('Add LeagueMates to your Home Screen')).not.toBeInTheDocument();
    unmount();
    render(<InstallHint />);
    expect(screen.queryByText('Add LeagueMates to your Home Screen')).not.toBeInTheDocument();
  });

  it("isn't shown on Android, where Chrome offers to install by itself", () => {
    as(ANDROID);
    render(<InstallHint />);
    expect(screen.queryByText('Add LeagueMates to your Home Screen')).not.toBeInTheDocument();
  });

  it('recognises an iPad, which reports itself as a Mac with touch', () => {
    expect(
      isIos({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        maxTouchPoints: 5,
      } as Navigator),
    ).toBe(true);
    expect(
      isIos({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        maxTouchPoints: 0,
      } as Navigator),
    ).toBe(false);
  });
});
