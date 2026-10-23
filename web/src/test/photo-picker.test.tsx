import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoPicker } from '@/components/PhotoPicker';

const narrow = window.matchMedia;
afterEach(() => {
  window.matchMedia = narrow;
});
/** A phone: a coarse pointer. */
const onPhone = () => {
  window.matchMedia = (q: string) => ({ ...narrow(q), matches: q.includes('coarse') });
};

describe('PhotoPicker', () => {
  it('on a computer, one button opens the file dialog', async () => {
    const onFiles = vi.fn();
    render(
      <PhotoPicker
        label="Scan a card"
        onFiles={onFiles}
        inputProps={{ 'aria-label': 'Card photo' }}
      />,
    );
    expect(screen.queryByRole('button', { name: /from photos/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Take a photo')).not.toBeInTheDocument();
    const pick = screen.getByLabelText('Card photo') as HTMLInputElement;
    const click = vi.spyOn(pick, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Scan a card' }));
    expect(click).toHaveBeenCalled();
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    await userEvent.upload(pick, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('on a phone, the button opens the camera and a second one the gallery', async () => {
    onPhone();
    const onFiles = vi.fn();
    render(
      <PhotoPicker
        label="Scan a card"
        onFiles={onFiles}
        inputProps={{ 'aria-label': 'Card photo' }}
      />,
    );
    const shoot = screen.getByLabelText('Take a photo') as HTMLInputElement;
    expect(shoot).toHaveAttribute('capture', 'environment');
    const pick = screen.getByLabelText('Card photo') as HTMLInputElement;
    expect(pick).not.toHaveAttribute('capture');
    const shootClick = vi.spyOn(shoot, 'click');
    const pickClick = vi.spyOn(pick, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Scan a card' }));
    expect(shootClick).toHaveBeenCalledTimes(1);
    expect(pickClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'From photos' }));
    expect(pickClick).toHaveBeenCalledTimes(1);
    const file = new File(['x'], 'card.jpg', { type: 'image/jpeg' });
    await userEvent.upload(shoot, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('takes several from the gallery only when asked', async () => {
    const onFiles = vi.fn();
    render(
      <PhotoPicker
        label="Add photos"
        multiple
        onFiles={onFiles}
        inputProps={{ 'aria-label': 'Photos' }}
      />,
    );
    const files = [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ];
    await userEvent.upload(screen.getByLabelText('Photos'), files);
    expect(onFiles).toHaveBeenCalledWith(files);
  });
});
