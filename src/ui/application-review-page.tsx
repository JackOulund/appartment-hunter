import { Layout } from "./layout.js";
import type { HousingListing, Language } from "../domain/entities.js";

export interface ApplicationReviewProps {
  applicationId: string;
  listing: HousingListing;
  message: string;
  recipientLabel: string;
  applicant: { fullName: string; email: string; phone: string };
  language: Language;
  confirmationToken: string;
  expiresAt: Date;
  capability: string;
  manualUrl?: string | undefined;
  dryRun: boolean;
}

const T = {
  en: {
    heading: "Review before sending",
    intro: "Nothing has been sent yet. Check the message and confirm below.",
    apartment: "Apartment", address: "Address", rent: "Monthly rent",
    recipient: "Goes to", shares: "You will share",
    message: "Your message", edit: "Save changes",
    confirm: "Send to landlord", cancel: "Cancel",
    expires: "This confirmation expires at",
    manual: "This landlord does not accept automatic applications. We'll show you the prepared message and open their site so you can submit it yourself.",
    dryRun: "Dry-run mode is on — confirming will simulate the send and record it, but no landlord will be contacted.",
    typeSend: "Type SEND to confirm",
  },
  sv: {
    heading: "Granska innan du skickar",
    intro: "Inget är skickat ännu. Läs igenom meddelandet och bekräfta nedan.",
    apartment: "Lägenhet", address: "Adress", rent: "Månadshyra",
    recipient: "Skickas till", shares: "Du delar",
    message: "Ditt meddelande", edit: "Spara ändringar",
    confirm: "Skicka till hyresvärden", cancel: "Avbryt",
    expires: "Bekräftelsen går ut",
    manual: "Den här hyresvärden tar inte emot automatiska ansökningar. Vi visar meddelandet och öppnar deras sida så att du kan skicka det själv.",
    dryRun: "Torrkörning är på — bekräftelsen simuleras och sparas, men ingen hyresvärd kontaktas.",
    typeSend: "Skriv SEND för att bekräfta",
  },
} as const;

export function ApplicationReviewPage(props: ApplicationReviewProps) {
  const t = T[props.language];
  const money = `${props.listing.monthlyRent.toLocaleString(
    props.language === "sv" ? "sv-SE" : "en-GB",
  )} ${props.listing.currency}`;

  return (
    <Layout title={t.heading}>
      <div class="page">
        <main class="content">
          <h1>{t.heading}</h1>
          <p class="subtitle">{t.intro}</p>

          {props.dryRun ? <div class="warn">{t.dryRun}</div> : null}
          {props.capability === "manual_handoff" ? <div class="warn">{t.manual}</div> : null}

          <section class="card">
            <dl class="rows">
              <div class="row"><dt>{t.apartment}</dt><dd>{props.listing.title}</dd></div>
              {props.listing.address ? (
                <div class="row"><dt>{t.address}</dt><dd>{props.listing.address}</dd></div>
              ) : null}
              <div class="row"><dt>{t.rent}</dt><dd>{money}</dd></div>
              <div class="row"><dt>{t.recipient}</dt><dd>{props.recipientLabel}</dd></div>
            </dl>
          </section>

          <section class="card">
            <h2>{t.shares}</h2>
            <dl class="rows">
              <div class="row"><dt>Name</dt><dd>{props.applicant.fullName}</dd></div>
              <div class="row"><dt>Email</dt><dd>{props.applicant.email}</dd></div>
              <div class="row"><dt>Phone</dt><dd>{props.applicant.phone}</dd></div>
            </dl>
          </section>

          <section class="card">
            <h2>{t.message}</h2>
            <form method="post" action={`/applications/${props.applicationId}/update`}>
              <textarea name="message" spellcheck={false}>{props.message}</textarea>
              <div class="stack">
                <button class="btn btn-secondary btn-full" type="submit">{t.edit}</button>
              </div>
            </form>
          </section>

          <form method="post" action={`/applications/${props.applicationId}/confirm`}>
            <input type="hidden" name="token" value={props.confirmationToken} />
            <div class="stack">
              <button class="btn btn-primary btn-full" type="submit">{t.confirm}</button>
            </div>
          </form>

          <form method="post" action={`/applications/${props.applicationId}/cancel`}>
            <div class="stack">
              <button class="btn btn-danger btn-full" type="submit">{t.cancel}</button>
            </div>
          </form>

          <p class="provider">
            {t.expires} {props.expiresAt.toISOString().slice(11, 16)} UTC
          </p>
        </main>
      </div>
    </Layout>
  );
}
