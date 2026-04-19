export const metadata = {
  title: 'privacy · whoop',
  description: 'Privacy policy for this personal-use WHOOP integration.',
};

export default function Privacy() {
  return (
    <main className="privacy">
      <div className="privacy-brand">
        <strong>WHOOP</strong><span className="slash">·</span>privacy
      </div>

      <h1 className="privacy-title">Privacy Policy</h1>
      <p className="privacy-updated">Last updated: April 19, 2026</p>

      <h2 data-num="00">Overview</h2>
      <p>
        This is a personal, single-user application that integrates with the
        WHOOP API to collect and display health and fitness data for its sole
        user (the application owner). This policy describes how that data is
        handled.
      </p>

      <h2 data-num="01">Scope</h2>
      <p>
        This application is <strong>not a public service</strong>. It is
        registered with the WHOOP Developer Platform for the personal use of its
        owner only. No other users can authenticate with this application.
        The public dashboard displays derived statistics only; raw API access
        is never exposed to visitors.
      </p>

      <h2 data-num="02">Data collected</h2>
      <p>
        When authorized via WHOOP OAuth 2.0, this application may access and
        store the following data for its single authorized user:
      </p>
      <ul>
        <li>Basic profile information (name, email, WHOOP user ID)</li>
        <li>Body measurements (height, weight, maximum heart rate)</li>
        <li>Physiological cycle data (day strain, heart rate, energy expenditure)</li>
        <li>Recovery data (recovery score, HRV, resting heart rate, SpO₂, skin temperature)</li>
        <li>Sleep data (duration, stage breakdown, performance, efficiency, disturbances)</li>
        <li>Workout data (sport type, duration, strain, heart rate zones, distance)</li>
      </ul>

      <h2 data-num="03">Storage</h2>
      <p>
        Data is stored in Upstash Redis (a serverless Redis-compatible database)
        connected to the application owner's Vercel project. OAuth access and
        refresh tokens are stored as encrypted environment variables and in
        Redis; they are never transmitted to the client or any third-party
        service.
      </p>

      <h2 data-num="04">Use</h2>
      <p>
        Data is used exclusively to generate a personal dashboard of derived
        health statistics. Visitors to the public dashboard see computed
        metrics (recovery score, strain, HRV, sleep hours, etc.) but never
        OAuth tokens or raw API payloads.
      </p>

      <h2 data-num="05">Retention</h2>
      <p>
        Data is retained indefinitely for the purpose of historical trend
        analysis. The application owner may delete stored data at any time by
        clearing Vercel KV.
      </p>

      <h2 data-num="06">Revocation</h2>
      <p>
        As the sole user, the application owner may revoke WHOOP access at any
        time from within the WHOOP app, or by using the{' '}
        <code>DELETE /v2/user/access</code> endpoint. Revocation stops all
        further data collection and invalidates stored tokens.
      </p>

      <h2 data-num="07">Third parties</h2>
      <p>
        Data is not shared with third parties. Hosting is provided by Vercel;
        their infrastructure terms govern the underlying storage and compute.
      </p>

      <h2 data-num="08">Contact</h2>
      <p>
        For any questions regarding this policy, contact the application owner
        at the email address registered with WHOOP for this application.
      </p>

      <footer className="privacy-footer">
        <span>whoop · v1</span>
        <a href="/">← dashboard</a>
      </footer>
    </main>
  );
}
