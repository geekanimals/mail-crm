'use client';
// Website Leads (admin): client forms from the website. Each is a Hot lead in Pipeline (Aanchal gets the meeting task).
import WebsiteForms from '@/lib/website-forms';

export default function WebsiteLeadsPage() {
  return <WebsiteForms form="client" title="Website Leads" intro="Client forms from geekcreativeagency.com. Each one starts as a Hot lead in Pipeline and Aanchal gets a task to reply and book a meeting. The status here is its Pipeline step: change it here or in Pipeline, both stay the same." />;
}
