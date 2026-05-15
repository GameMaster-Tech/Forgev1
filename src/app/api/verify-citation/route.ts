const CROSSREF_API_URL =
  process.env.CROSSREF_API_URL || "https://api.crossref.org/works";

export async function POST(request: Request) {
  try {
    const { title, author } = await request.json();

    if (!title) {
      return Response.json({ error: "Title is required" }, { status: 400 });
    }

    // Query Crossref by title (and author if available)
    const queryParts = [`query.title=${encodeURIComponent(title)}`];
    if (author) {
      queryParts.push(`query.author=${encodeURIComponent(author)}`);
    }
    queryParts.push("rows=1");
    queryParts.push("mailto=research@forgeresearch.ai");

    const url = `${CROSSREF_API_URL}?${queryParts.join("&")}`;
    const res = await fetch(url);

    if (!res.ok) {
      return Response.json(
        { error: "Crossref lookup failed" },
        { status: 502 }
      );
    }

    const data = await res.json();
    const items = data.message?.items;

    if (!items || items.length === 0) {
      return Response.json({
        verified: false,
        message: "No matching publication found in Crossref",
      });
    }

    const match = items[0];
    const doi = match.DOI;
    const matchTitle = match.title?.[0] || "";
    const matchAuthors = (match.author || [])
      .map(
        (a: { given?: string; family?: string }) =>
          `${a.given || ""} ${a.family || ""}`.trim()
      )
      .join(", ");
    const journal = match["container-title"]?.[0] || "";
    const year =
      match.published?.["date-parts"]?.[0]?.[0] ||
      match.created?.["date-parts"]?.[0]?.[0] ||
      null;

    return Response.json({
      verified: true,
      doi,
      title: matchTitle,
      authors: matchAuthors,
      journal,
      year,
      url: `https://doi.org/${doi}`,
    });
  } catch (error) {
    console.error("Crossref verification error:", error);
    return Response.json(
      { error: "Citation verification failed" },
      { status: 500 }
    );
  }
}
