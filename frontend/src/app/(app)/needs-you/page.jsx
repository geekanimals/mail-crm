'use client';
// Needs you (admin): everything the CRM wants a person to decide - reply sorting, meetings, "How was the meeting?" -
// plus the planned follow-ups and the last decisions (with Undo).
import NeedsYou from '@/components/NeedsYou';

export default function NeedsYouPage() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>Needs you</h1>
          <p>The CRM reads every reply and the calendar, then suggests what to do. Nothing happens until you press &quot;Yes, do it&quot;. The message for a follow-up is chosen here once; the CRM sends it on that date.</p>
        </div>
      </div>
      <NeedsYou />
    </>
  );
}
