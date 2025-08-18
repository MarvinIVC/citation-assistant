// Serverless function to fetch DOI metadata from Crossref
exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const doi = event.queryStringParameters?.doi;
  if (!doi) {
    return { statusCode: 400, body: "Missing DOI parameter" };
  }

  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": "CitationAssistant/1.0 (mailto:admin@mwsys.xyz)" }
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: `Failed to fetch DOI metadata: ${res.statusText}`
      };
    }

    const json = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(json)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: `Error: ${error.message}`
    };
  }
};
