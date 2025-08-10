// Serverless function to fetch a URL and extract citation-friendly metadata
// Deployed at: /.netlify/functions/urlMeta
// Supports: GET ?url=..., returns JSON

const ok = (data) => ({
  statusCode: 200,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  body: JSON.stringify(data)
});

const err = (status, message) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  body: JSON.stringify({ error: message })
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return err(405, "Method not allowed");
  }

  const url = event.queryStringParameters?.url;
  if (!url) return err(400, "Missing url parameter");

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "CitationAssistantBot/1.0 (+https://example.com) Mozilla/5.0"
      },
      redirect: "follow"
    });

    if (!res.ok) {
      return err(res.status, `Failed to fetch: ${res.statusText}`);
    }

    const html = await res.text();

    // Helpers
    const getMeta = (names) => {
      for (const n of names) {
        const re = new RegExp(
          `<meta[^>]+(?:name|property|itemprop)=[\\"']${escapeRegExp(
            n
          )}[\\"'][^>]*content=[\\"']([^\\"]+)[\\"'][^>]*>`,
          "i"
        );
        const m = html.match(re);
        if (m && m[1]) return decode(m[1]);
      }
      return null;
    };

    const getAllMeta = (name) => {
      const re = new RegExp(
        `<meta[^>]+(?:name|property|itemprop)=[\\"']${escapeRegExp(
          name
        )}[\\"'][^>]*content=[\\"']([^\\"]+)[\\"'][^>]*>`,
        "ig"
      );
      const out = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        if (m[1]) out.push(decode(m[1]));
      }
      return out;
    };

    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
      const m = html.match(re);
      return m ? decode(strip(m[1])) : null;
    };

    const getJSONLD = () => {
      const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      const blocks = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        try {
          const json = JSON.parse(m[1].trim());
          blocks.push(json);
        } catch (_e) {}
      }
      return blocks;
    };

    // Extract fields
    const title =
      getMeta([
        "citation_title",
        "og:title",
        "twitter:title",
        "dc.title",
        "DC.title",
        "headline",
        "title"
      ]) || getTag("title");

    const siteName =
      getMeta(["og:site_name", "twitter:site", "application-name"]) || null;

    const publisher =
      getMeta([
        "citation_publisher",
        "publisher",
        "dc.publisher",
        "DC.publisher"
      ]) || siteName;

    const authorsMeta =
      getAllMeta("citation_author").length > 0
        ? getAllMeta("citation_author")
        : [];

    // Some sites use 'author' (single) or JSON-LD authors
    let authorSingle =
      getMeta(["author", "article:author", "dc.creator", "DC.creator"]) || null;

    // Dates
    const publishedRaw =
      getMeta([
        "citation_publication_date",
        "article:published_time",
        "datePublished",
        "pubdate",
        "dc.date",
        "DC.date",
        "date"
      ]) || null;

    const modifiedRaw =
      getMeta(["article:modified_time", "dateModified"]) || null;

    const doi =
      getMeta(["citation_doi", "doi", "DC.identifier"]) ||
      extractDOIFromHTML(html);

    const container =
      getMeta([
        "citation_journal_title",
        "citation_conference_title",
        "citation_inbook_title",
        "citation_technical_report_institution",
        "og:site_name"
      ]) || null;

    const volume = getMeta(["citation_volume"]) || null;
    const issue = getMeta(["citation_issue"]) || null;

    const firstPage = getMeta(["citation_firstpage"]) || null;
    const lastPage = getMeta(["citation_lastpage"]) || null;
    const pages =
      firstPage && lastPage
        ? `${firstPage}-${lastPage}`
        : firstPage || lastPage || null;

    const canonical =
      (html.match(
        /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
      ) || [])[1] || null;

    const finalURL = canonical || res.url || url;

    // Try JSON-LD for richer data
    const jsonld = getJSONLD();
    let ld = {};
    const flatten = (obj) => (Array.isArray(obj) ? obj : [obj]);
    for (const block of jsonld) {
      const list = flatten(block["@graph"] || block);
      for (const node of list) {
        const type = node["@type"];
        if (
          type &&
          (String(type).toLowerCase().includes("article") ||
            String(type).toLowerCase().includes("creativework") ||
            String(type).toLowerCase().includes("scholarlyarticle") ||
            String(type).toLowerCase().includes("webpage"))
        ) {
          ld = { ...ld, ...node };
        }
      }
    }

    // Authors normalization
    const ldAuthors = parseLDAuthors(ld);
    const authors = normalizeAuthors(
      authorsMeta.length ? authorsMeta : ldAuthors.length ? ldAuthors : [authorSingle].filter(Boolean)
    );

    // Title preference: JSON-LD headline > meta title > <title>
    const finalTitle = decode(prefer(ld.headline, title));

    // Publisher/site name fallback
    const finalPublisher =
      prefer(
        toText(ld?.publisher?.name || ld?.publisher),
        publisher || siteName
      ) || null;

    const website =
      toText(ld?.isPartOf?.name || ld?.sourceOrganization?.name) ||
      siteName ||
      null;

    // Dates
    const datePublished = prefer(ld.datePublished, publishedRaw);
    const dateModified = prefer(ld.dateModified, modifiedRaw);

    // Page range override from JSON-LD if present
    const pageRange =
      ld.pageStart && ld.pageEnd ? `${ld.pageStart}-${ld.pageEnd}` : pages;

    // Type inference
    const type = inferType({
      ldType: ld["@type"],
      container,
      doi,
      website,
      url: finalURL
    });

    const result = {
      type, // "journal-article", "webpage", "book", "generic"
      title: finalTitle,
      authors,
      container: container || website || null,
      website,
      publisher: finalPublisher,
      datePublished,
      dateModified,
      year: safeYear(datePublished),
      volume,
      issue,
      pages: pageRange,
      doi: normalizeDOI(doi),
      url: finalURL
    };

    return ok({ ok: true, source: "url", result });
  } catch (e) {
    return err(500, `Error: ${e.message}`);
  }
};

// Helpers
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function strip(s) {
  return s.replace(/\s+/g, " ").trim();
}
function decode(s) {
  if (!s) return s;
  return strip(
    s
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  );
}
function prefer(a, b) {
  return a && String(a).trim() ? a : b;
}
function toText(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x.name) return x.name;
  return null;
}
function parseLDAuthors(ld) {
  const a = ld?.author;
  if (!a) return [];
  if (Array.isArray(a)) return a.map((x) => toText(x) || x.name || "").filter(Boolean);
  return [toText(a) || a.name || ""].filter(Boolean);
}
function normalizeAuthors(rawList) {
  const clean = rawList
    .map((s) => s && String(s).trim())
    .filter(Boolean)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  return clean.map((full) => {
    // If already "Last, First"
    if (full.includes(",")) {
      const [last, ...rest] = full.split(",");
      const given = rest.join(",").trim();
      return { given, family: last.trim(), literal: full.trim() };
    }
    const parts = full.split(" ");
    if (parts.length === 1) return { given: "", family: parts[0], literal: full };
    const family = parts.pop();
    const given = parts.join(" ");
    return { given, family, literal: full };
  });
}
function extractDOIFromHTML(html) {
  const m = html.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m ? m[0] : null;
}
function normalizeDOI(doi) {
  if (!doi) return null;
  const d = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return d;
}
function safeYear(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.getUTCFullYear();
}
function inferType({ ldType, container, doi, website, url }) {
  const t = String(ldType || "").toLowerCase();
  if (t.includes("scholarlyarticle") || t.includes("journal")) return "journal-article";
  if (t.includes("book")) return "book";
  if (doi) return "journal-article";
  if (container && !website) return "journal-article";
  if (/^https?:\/\//i.test(url)) return "webpage";
  return "generic";
}
