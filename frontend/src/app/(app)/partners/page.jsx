'use client';
// Partners (admin): partner / vendor forms from the website. The admin picks the employee who handles them.
import WebsiteForms from '@/lib/website-forms';

export default function PartnersPage() {
  return <WebsiteForms form="vendor" title="Partners" intro="Partners and vendors who want to work with Geek, from the website's partner form." />;
}
