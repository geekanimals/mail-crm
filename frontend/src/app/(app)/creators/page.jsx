'use client';
// Creators (admin): creator forms from the website. The admin picks the employee who handles them.
import WebsiteForms from '@/lib/website-forms';

export default function CreatorsPage() {
  return <WebsiteForms form="creator" title="Creators" intro="Creators who want to work with Geek, from the website's creator form." />;
}
