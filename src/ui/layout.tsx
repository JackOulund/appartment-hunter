import type { PropsWithChildren } from "hono/jsx";
import { STYLES } from "./styles.js";

export interface OpenGraph {
  title: string;
  description: string;
  image?: string | undefined;
  url?: string | undefined;
}

/**
 * Shared document shell. The Open Graph tags are what make the rich link render
 * as a preview card in iMessage.
 */
export function Layout(
  props: PropsWithChildren<{ title: string; og?: OpenGraph }>,
) {
  const og = props.og;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5"
        />
        <meta name="color-scheme" content="light dark" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{props.title}</title>
        {og ? (
          <>
            <meta property="og:type" content="website" />
            <meta property="og:title" content={og.title} />
            <meta property="og:description" content={og.description} />
            {og.image ? <meta property="og:image" content={og.image} /> : null}
            {og.url ? <meta property="og:url" content={og.url} /> : null}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={og.title} />
            <meta name="twitter:description" content={og.description} />
            {og.image ? <meta name="twitter:image" content={og.image} /> : null}
          </>
        ) : null}
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>{props.children}</body>
    </html>
  );
}

/** Polished terminal states: expired links, errors, confirmations. */
export function StatePage(props: {
  glyph: string;
  title: string;
  message: string;
  action?: { label: string; href: string } | undefined;
}) {
  return (
    <Layout title={props.title}>
      <main class="state">
        <div class="glyph">{props.glyph}</div>
        <h1>{props.title}</h1>
        <p>{props.message}</p>
        {props.action ? (
          <a class="btn btn-secondary" href={props.action.href} style="margin-top:14px">
            {props.action.label}
          </a>
        ) : null}
      </main>
    </Layout>
  );
}
