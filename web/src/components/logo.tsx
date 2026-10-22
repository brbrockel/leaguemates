// Imported through the build, so it ships inside the app bundle: a new icon shows on the next
// load instead of waiting out the CDN's cache of /icon.svg.
import icon from '../../public/icon.svg';

export function Logo({ className = 'size-8' }: { className?: string }) {
  return <img src={icon} alt="" className={className} />;
}
