import { Mail, MapPin, MessageSquare, Phone } from 'lucide-react';
import { formatPhone, mapsUrl } from '@/lib/phone';

/** Tap-to-call, text, email and map links for a person. */
export function ContactLinks({
  email,
  phone,
  address,
}: {
  email?: string;
  phone?: string | null;
  address?: string | null;
}) {
  const link = 'inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary';
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {phone && (
        <>
          <a className={link} href={`tel:${phone}`}>
            <Phone className="size-3.5" aria-hidden /> {formatPhone(phone)}
          </a>
          <a className={link} href={`sms:${phone}`} aria-label={`Text ${formatPhone(phone)}`}>
            <MessageSquare className="size-3.5" aria-hidden /> Text
          </a>
        </>
      )}
      {email && (
        <a className={link} href={`mailto:${email}`}>
          <Mail className="size-3.5" aria-hidden /> {email}
        </a>
      )}
      {address && (
        <a className={link} href={mapsUrl(address)} target="_blank" rel="noreferrer">
          <MapPin className="size-3.5" aria-hidden /> {address}
        </a>
      )}
    </div>
  );
}
