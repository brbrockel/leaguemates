import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { formatPhone } from '@/lib/phone';

export interface Details {
  name: string | null;
  nickname: string | null;
  phone: string | null;
  address: string | null;
}

/** Name, nickname, phone and address form, shared by Account and the People screen. */
export function DetailsForm({
  initial,
  onSave,
  saving,
  error,
  saved,
}: {
  initial: Details;
  onSave: (d: {
    name: string | null;
    nickname: string | null;
    phone: string;
    address: string;
  }) => void;
  saving: boolean;
  error: string | null;
  saved?: boolean;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [nickname, setNickname] = useState(initial.nickname ?? '');
  const [phone, setPhone] = useState(initial.phone ? formatPhone(initial.phone) : '');
  const [address, setAddress] = useState(initial.address ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim() || null, nickname: nickname.trim() || null, phone, address });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="details-name">Name</Label>
        <Input
          id="details-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="details-nickname">Nickname</Label>
        <Input
          id="details-nickname"
          autoComplete="nickname"
          maxLength={30}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="What everyone calls you"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="details-phone">Phone</Label>
        <Input
          id="details-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(860) 555-1234"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="details-address">Address</Label>
        <Input
          id="details-address"
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Street, town"
        />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-primary">Saved</span>}
      </div>
    </form>
  );
}
