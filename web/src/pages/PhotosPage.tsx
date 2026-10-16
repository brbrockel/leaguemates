import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { PhotosCard } from '@/components/Photos';

export function PhotosPage() {
  const { leagueId = '' } = useParams();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          to={`/leagues/${leagueId}`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> League
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Photos</h1>
        <p className="text-sm text-muted-foreground">
          From every match, newest first. Add photos to a match from its scorecard.
        </p>
      </div>
      <PhotosCard leagueId={leagueId} title="All photos" showMatch />
    </div>
  );
}
