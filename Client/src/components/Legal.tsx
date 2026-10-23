/**
 * Yard Rules, Privacy Policy and Terms.
 * ⚠ DRAFT TEMPLATES — fill the [BRACKETS] and have a lawyer review before launch.
 * Contact details live in one place (CONTACT) so they're easy to update.
 */
import { socket } from "../lib/socket";

export const CONTACT = {
  operator: "[OPERATOR / COMPANY NAME]",
  address: "[REGISTERED ADDRESS]",
  email: "[support@yourdomain.com]",
  grievanceOfficer: "[GRIEVANCE OFFICER NAME]",
  grievanceEmail: "[grievance@yourdomain.com]",
  updated: "[DATE]",
};

export type LegalPage = "rules" | "privacy" | "terms";
export const LEGAL_PATHS: Record<string, LegalPage> = { "/rules": "rules", "/privacy": "privacy", "/terms": "terms" };

function deleteMyData() {
  if (!window.confirm("Delete your coins, bar shelf, cheers and saved settings from Drunk Yard? This can't be undone.")) return;
  const done = () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    window.location.href = "/";
  };
  if (!socket.connected) socket.connect();
  socket.timeout(5000).emit("account:delete", () => done());
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <h2 className="section-title">{title}</h2>
    {children}
  </section>
);

function Rules() {
  return (
    <>
      <h1 className="display">Yard Rules</h1>
      <p className="muted">Short version: be kind, keep it clothed, adults only. Break these and you’re out.</p>
      <Section title="Who can use Drunk Yard">
        <ul>
          <li>You must be 18 or older. If someone looks or says they’re under 18, report them with “Looks under 18” and leave.</li>
          <li>Drinking is optional and never required. Nothing here rewards actually drinking — please drink responsibly, never drink and drive.</li>
        </ul>
      </Section>
      <Section title="Not allowed — instant ban">
        <ul>
          <li>Nudity, sexual acts or sexual content of any kind, on camera or in chat.</li>
          <li>Anything involving minors in a sexual way. We report child sexual exploitation to the authorities.</li>
          <li>Harassment, threats, hate speech, or targeting people for who they are.</li>
          <li>Violence, self-harm encouragement, weapons, illegal drugs, or anything illegal where you or they live.</li>
          <li>Recording, screenshotting or sharing other people without their consent.</li>
          <li>Spam, scams, selling things, links, or asking people to move to other apps for money.</li>
          <li>Pretending to be someone else, or sharing anyone’s personal information (doxxing).</li>
        </ul>
      </Section>
      <Section title="If something goes wrong">
        <ul>
          <li>Tap the flag on their video to report. They never learn who reported them, and you’ll never be matched again.</li>
          <li>Press Next or Leave any time — you never owe anyone a conversation.</li>
          <li>Emergency? Contact local emergency services first.</li>
          <li>Appeals and complaints: {CONTACT.grievanceEmail}</li>
        </ul>
      </Section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1 className="display">Privacy Policy</h1>
      <p className="muted">Last updated {CONTACT.updated}. Operated by {CONTACT.operator}, {CONTACT.address}.</p>
      <Section title="The short version">
        <ul>
          <li>No accounts, no names, no email, no ads, no tracking cookies, no analytics.</li>
          <li>Your video and audio go directly between you and the people in your room (or through an encrypted relay). We don’t record or store calls.</li>
          <li>Chat messages are relayed live and not stored.</li>
        </ul>
      </Section>
      <Section title="What we process and why">
        <ul>
          <li><b>A random device ID</b> stored in your browser — to keep your coins and bar shelf and to enforce bans. Strictly necessary for the service.</li>
          <li><b>Your IP address</b> — kept in server memory to prevent abuse (rate limits, bans). Short bans may store it for up to 30 minutes.</li>
          <li><b>Reports</b> you make or receive (reason, time, pseudonymous device IDs) — to keep the service safe. Kept up to 1 year, longer where the law requires (e.g. child-safety reports to authorities).</li>
          <li><b>Coins, cheers and drinks</b> — linked only to your device ID.</li>
          <li><b>Peer-to-peer video:</b> when you connect directly, the other person’s browser can technically see your IP address. Turn on <b>Hide my IP</b> in the lobby to route video through our relay instead.</li>
        </ul>
      </Section>
      <Section title="Your rights">
        <p>
          Depending on where you live (GDPR in the EU/UK, DPDP Act in India, CCPA in California and others) you can access, correct or delete
          your data, and object to processing. The fastest way: <button className="btn" style={{ height: 36 }} onClick={deleteMyData}>Delete my data</button>{" "}
          Or email {CONTACT.email}. Grievance Officer (India): {CONTACT.grievanceOfficer}, {CONTACT.grievanceEmail} — we acknowledge within 24
          hours and resolve within the legal deadline.
        </p>
      </Section>
      <Section title="Processors & transfers">
        <p>
          Hosting: Render (server) and Vercel (website). Video relay: Cloudflare (when configured). These providers may process data outside your
          country under standard contractual safeguards.
        </p>
      </Section>
      <Section title="Children">
        <p>Drunk Yard is for adults 18+. We don’t knowingly process children’s data; accounts reported as minors are removed.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1 className="display">Terms of Service</h1>
      <p className="muted">Last updated {CONTACT.updated}. By using Drunk Yard you agree to these terms and the Yard Rules.</p>
      <Section title="The service">
        <p>Drunk Yard connects you with random adults for live video, chat and games. People you meet are strangers — we can’t verify who they are. Use your judgement and never share personal details.</p>
      </Section>
      <Section title="Your responsibilities">
        <p>You must be 18+, follow the Yard Rules and the law where you are, and not attempt to break, overload, scrape or reverse-engineer the service.</p>
      </Section>
      <Section title="Coins and virtual drinks">
        <p>Coins and drinks are virtual items with no cash value. They can’t be exchanged, refunded or withdrawn, and may be reset. Drink names are fictional and not real products.</p>
      </Section>
      <Section title="Moderation">
        <p>We may remove, restrict or ban anyone who breaks the rules, with or without notice. You can appeal at {CONTACT.grievanceEmail}; we’ll explain decisions where the law requires.</p>
      </Section>
      <Section title="No warranty & liability">
        <p>The service is provided “as is”. To the extent allowed by law, we’re not liable for what other users say or do, or for interruptions or data loss.</p>
      </Section>
      <Section title="Contact">
        <p>{CONTACT.operator}, {CONTACT.address} — {CONTACT.email}</p>
      </Section>
    </>
  );
}

export function Legal({ page }: { page: LegalPage }) {
  return (
    <main className="recap" style={{ maxWidth: 720, gap: 22, lineHeight: 1.55 }}>
      <a href="/" className="muted" style={{ fontSize: 14 }}>
        ← Back to the yard
      </a>
      {page === "rules" ? <Rules /> : page === "privacy" ? <Privacy /> : <Terms />}
      <nav className="row muted" style={{ gap: 16, fontSize: 13, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        <a href="/rules">Rules</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </nav>
    </main>
  );
}

export function LegalFooter() {
  return (
    <nav className="row muted" style={{ gap: 16, fontSize: 12, justifyContent: "center", flexWrap: "wrap" }} aria-label="Legal">
      <a href="/rules">Yard Rules</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href={`mailto:${CONTACT.grievanceEmail.replace(/[[\]]/g, "")}`}>Report a problem</a>
    </nav>
  );
}
