import { Layout } from "./layout.js";
import type { HousingListing, Language, ScoreReason } from "../domain/entities.js";
import { formatDate } from "../utils/dates.js";

export interface ListingPageProps {
  listing: HousingListing;
  token: string;
  reasons: ScoreReason[];
  commuteMinutes: number | null;
  universityName: string | null;
  language: Language;
  alreadyRejected: boolean;
  alreadyContacted: boolean;
  baseUrl: string;
}

const T = {
  en: {
    rent: "Monthly rent", rooms: "Rooms", size: "Size", furnished: "Furnished",
    available: "Available from", until: "Available until", duration: "Minimum stay",
    university: "University", commute: "Estimated commute", area: "Area",
    whyMatches: "Why this matches", about: "About this apartment", amenities: "Amenities",
    details: "Details", reject: "Reject", contact: "Contact landlord",
    yes: "Yes", no: "No", months: "months", minutes: "minutes to campus",
    rejected: "You rejected this apartment", contacted: "You have already contacted this landlord",
    viewOriginal: "View original listing",
  },
  sv: {
    rent: "Månadshyra", rooms: "Rum", size: "Storlek", furnished: "Möblerad",
    available: "Ledig från", until: "Ledig till", duration: "Minsta hyrestid",
    university: "Universitet", commute: "Uppskattad restid", area: "Område",
    whyMatches: "Varför den matchar", about: "Om lägenheten", amenities: "Bekvämligheter",
    details: "Detaljer", reject: "Neka", contact: "Kontakta hyresvärd",
    yes: "Ja", no: "Nej", months: "månader", minutes: "minuter till campus",
    rejected: "Du har nekat den här lägenheten", contacted: "Du har redan kontaktat hyresvärden",
    viewOriginal: "Visa originalannonsen",
  },
} as const;

/** Updates the gallery indicator. The only client-side script on the page. */
const GALLERY_SCRIPT = `
(function () {
  var gallery = document.querySelector('.gallery');
  var dots = document.querySelectorAll('.dot');
  if (!gallery || dots.length < 2) return;
  var update = function () {
    var index = Math.round(gallery.scrollLeft / gallery.clientWidth);
    for (var i = 0; i < dots.length; i++) {
      dots[i].setAttribute('data-active', String(i === index));
    }
  };
  gallery.addEventListener('scroll', function () {
    window.requestAnimationFrame(update);
  }, { passive: true });
})();
`;

const CONFIRM_REJECT_SCRIPT = `
(function () {
  var form = document.getElementById('reject-form');
  if (!form) return;
  form.addEventListener('submit', function () {
    var button = form.querySelector('button');
    if (button) { button.setAttribute('disabled', 'disabled'); button.textContent = '…'; }
  });
})();
`;

export function ListingPage(props: ListingPageProps) {
  const { listing, language } = props;
  const t = T[language];
  const money = `${listing.monthlyRent.toLocaleString(language === "sv" ? "sv-SE" : "en-GB")} ${listing.currency}`;
  const locale = language === "sv" ? "sv-SE" : "en-GB";

  const description = `${money}/month · ${listing.area ?? listing.city}${
    listing.rooms !== null ? ` · ${listing.rooms} rooms` : ""
  }${listing.sizeSquareMeters !== null ? ` · ${listing.sizeSquareMeters} m²` : ""}`;

  return (
    <Layout
      title={`${listing.title} — ${money}/month`}
      og={{
        title: listing.title,
        description,
        image: listing.imageUrls[0],
        url: `${props.baseUrl}/l/${props.token}`,
      }}
    >
      <div class="page">
        {listing.imageUrls.length > 0 ? (
          <>
            <div class="gallery">
              {listing.imageUrls.map((url, index) => (
                <figure>
                  <img
                    src={url}
                    alt={`${listing.title} — photo ${index + 1}`}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                </figure>
              ))}
            </div>
            {listing.imageUrls.length > 1 ? (
              <div class="dots">
                {listing.imageUrls.map((_, index) => (
                  <span class="dot" data-active={index === 0 ? "true" : "false"} />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div class="gallery-empty">No photos provided</div>
        )}

        <main class="content">
          <h1>{listing.title}</h1>
          <p class="subtitle">{[listing.area, listing.city].filter(Boolean).join(", ")}</p>
          <p class="price">{money}<span style="font-size:16px;font-weight:400;color:var(--muted)">/month</span></p>

          {props.alreadyRejected ? <div class="warn">{t.rejected}</div> : null}
          {props.alreadyContacted ? <div class="warn">{t.contacted}</div> : null}

          {props.reasons.length > 0 ? (
            <section class="card match">
              <h2>{t.whyMatches}</h2>
              <ul>
                {props.reasons.map((reason) => (
                  <li>
                    <span class="tick">✓</span>
                    <span>{reason.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section class="card">
            <h2>{t.details}</h2>
            <dl class="rows">
              <div class="row"><dt>{t.rent}</dt><dd>{money}</dd></div>
              {listing.rooms !== null ? (
                <div class="row"><dt>{t.rooms}</dt><dd>{listing.rooms}</dd></div>
              ) : null}
              {listing.sizeSquareMeters !== null ? (
                <div class="row"><dt>{t.size}</dt><dd>{listing.sizeSquareMeters} m²</dd></div>
              ) : null}
              {listing.furnished !== null ? (
                <div class="row"><dt>{t.furnished}</dt><dd>{listing.furnished ? t.yes : t.no}</dd></div>
              ) : null}
              {listing.availableFrom ? (
                <div class="row"><dt>{t.available}</dt><dd>{formatDate(listing.availableFrom, locale)}</dd></div>
              ) : null}
              {listing.availableTo ? (
                <div class="row"><dt>{t.until}</dt><dd>{formatDate(listing.availableTo, locale)}</dd></div>
              ) : null}
              {listing.minimumRentalMonths !== null ? (
                <div class="row"><dt>{t.duration}</dt><dd>{listing.minimumRentalMonths} {t.months}</dd></div>
              ) : null}
              {listing.area ? <div class="row"><dt>{t.area}</dt><dd>{listing.area}</dd></div> : null}
              {props.universityName ? (
                <div class="row"><dt>{t.university}</dt><dd>{props.universityName}</dd></div>
              ) : null}
              {props.commuteMinutes !== null ? (
                <div class="row"><dt>{t.commute}</dt><dd>{props.commuteMinutes} {t.minutes}</dd></div>
              ) : null}
            </dl>
          </section>

          {listing.description ? (
            <section class="card">
              <h2>{t.about}</h2>
              <p class="description">{listing.description}</p>
            </section>
          ) : null}

          {listing.amenities.length > 0 ? (
            <section class="card">
              <h2>{t.amenities}</h2>
              <div class="chips">
                {listing.amenities.map((amenity) => (
                  <span class="chip">{amenity}</span>
                ))}
              </div>
            </section>
          ) : null}

          <p class="provider">
            Listed via {listing.provider}
            {listing.canonicalUrl ? (
              <>
                {" · "}
                <a href={listing.canonicalUrl} rel="noopener noreferrer nofollow" target="_blank">
                  {t.viewOriginal}
                </a>
              </>
            ) : null}
          </p>
        </main>

        <nav class="actionbar">
          <form id="reject-form" method="post" action={`/l/${props.token}/reject`} style="flex:1;display:flex">
            <button class="btn btn-danger" type="submit" disabled={props.alreadyRejected}>
              {t.reject}
            </button>
          </form>
          <a
            class={`btn btn-primary${props.alreadyContacted ? " " : ""}`}
            href={`/l/${props.token}/contact`}
            style="flex:1"
          >
            {t.contact}
          </a>
        </nav>
      </div>
      <script dangerouslySetInnerHTML={{ __html: GALLERY_SCRIPT + CONFIRM_REJECT_SCRIPT }} />
    </Layout>
  );
}
