import { Link } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';

/**
 * Both live-room surfaces — creating one and joining one — need a process that
 * can hold a WebSocket open, and a serverless deployment has none. Rather than
 * render a form that can never submit, the pages hand the user the flow that
 * does work without infrastructure: the Watch together link.
 */
export default function NeedsBackend({
  heading = 'This room needs an always-on backend',
  lead = 'Pause-and-seek mirroring runs over a live connection, which a serverless deployment cannot hold.',
  action = 'You can still watch together without it:',
  buttonLabel = 'Watch together',
  tail = 'Send the link and both phones count down to the same second.',
  backTo = '/',
  backLabel = 'Back to the catalogue',
}) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4 pt-28">
      <div className="max-w-[520px] rounded-3xl border border-white/[0.08] bg-white/[0.03] p-7 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-secondary/18 text-secondary">
          <Users className="h-5 w-5" />
        </span>
        <h2 className="font-display text-[20px] font-extrabold text-white">{heading}</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-textSub">{lead}</p>
        <p className="mt-2.5 text-[13px] leading-relaxed text-textSub">
          {action}{' '}
          <strong className="font-bold text-white">
            open any title and tap {buttonLabel}
          </strong>
          . {tail}
        </p>
        <Link to={backTo} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-bold text-white hover:bg-primaryLight">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
      </div>
    </div>
  );
}
