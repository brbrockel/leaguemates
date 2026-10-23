import { Camera, ImageIcon } from 'lucide-react';
import { useRef, useState, type ComponentProps, type InputHTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Phones and tablets: a camera is at hand and the file chooser may leave it out. */
const hasCamera = () => window.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * A button that takes a photo. On a phone it opens the camera straight away (an installed
 * app's file chooser doesn't always offer it) and a second button chooses from the gallery;
 * on a computer the one button opens the file dialog.
 */
export function PhotoPicker({
  label,
  pending,
  pendingLabel = 'Uploading…',
  multiple = false,
  onFiles,
  disabled,
  variant = 'outline',
  size,
  className,
  inputProps,
}: {
  label: string;
  pending?: boolean;
  pendingLabel?: string;
  /** Several from the gallery; the camera takes one at a time. */
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
  /** On the gallery input, e.g. `aria-label` or a `data-` hook for tests. */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  const [camera] = useState(hasCamera);
  const shoot = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  const off = disabled || pending;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={off}
        onClick={() => (camera ? shoot : pick).current?.click()}
      >
        <Camera /> {pending ? pendingLabel : label}
      </Button>
      {camera && (
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={off}
          onClick={() => pick.current?.click()}
        >
          <ImageIcon /> From photos
        </Button>
      )}
      {camera && (
        <input
          ref={shoot}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take a photo"
          hidden
          onChange={change}
        />
      )}
      <input
        ref={pick}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        {...inputProps}
        onChange={change}
      />
    </span>
  );
}
