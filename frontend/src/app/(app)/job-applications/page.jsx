'use client';
// Job Applications (admin): career forms from the website, with resumes. The admin picks the employee who handles them.
import WebsiteForms from '@/lib/website-forms';

export default function JobApplicationsPage() {
  return <WebsiteForms form="career" title="Job Applications" intro="Career forms from the website, with the resume. Choose who handles them: they get a task for each new application." />;
}
