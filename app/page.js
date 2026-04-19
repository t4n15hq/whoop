import Dashboard from '@/components/Dashboard';

// Disable static generation — the dashboard fetches from /api/whoop which
// reads from KV. We want the HTML shell served fast but data always fresh.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <Dashboard />;
}
