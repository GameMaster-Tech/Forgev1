import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY!);

export async function POST(request: Request) {
  try {
    const { query, mode } = await request.json();

    if (!query || typeof query !== "string") {
      return Response.json({ error: "Query is required" }, { status: 400 });
    }

    // Mode: "answer" for synthesized answer with citations (primary)
    // Mode: "search" for lightweight source discovery (fallback)
    if (mode === "answer" || mode === "synthesis") {
      const response = await exa.answer(query, {
        text: true,
        model: "exa",
      });

      return Response.json({
        type: "answer",
        answer: response.answer as string,
        citations: response.citations.map((c) => ({
          title: c.title,
          url: c.url,
          text: (c as Record<string, unknown>).text ?? null,
          publishedDate: c.publishedDate,
          author: c.author,
        })),
      });
    }

    // Default: search mode — lightweight discovery
    const results = await exa.search(query, {
      type: "auto",
      numResults: 5,
      useAutoprompt: true,
    });

    return Response.json({
      type: "search",
      results: results.results.map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
      })),
    });
  } catch (error) {
    console.error("Exa API error:", error);
    return Response.json(
      { error: "Research query failed" },
      { status: 500 }
    );
  }
}
