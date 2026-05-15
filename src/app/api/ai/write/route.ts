import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

type AICommand = "continue" | "summarize" | "expand" | "simplify" | "fix-grammar" | "make-concise" | "rewrite-formal" | "rewrite-casual";

const systemPrompt = `You are a writing assistant embedded in Forge, an AI research workspace. You help researchers write, edit, and refine their documents.

Rules:
- Return ONLY the generated/edited text, no explanations or meta-commentary
- Match the tone and style of the surrounding context
- Preserve any citations or references
- Keep academic rigor when the content is scholarly
- Output clean prose, no markdown headers unless continuing a section that uses them`;

const commandPrompts: Record<AICommand, (text: string, context: string) => string> = {
  continue: (text, context) =>
    `Continue writing from where this text left off. Match the style and flow.\n\nDocument context:\n${context}\n\nContinue from:\n${text}`,
  summarize: (text) =>
    `Summarize the following text concisely while preserving key points and citations:\n\n${text}`,
  expand: (text) =>
    `Expand on the following text with more detail, examples, or supporting points:\n\n${text}`,
  simplify: (text) =>
    `Rewrite the following text in simpler, clearer language while preserving the meaning:\n\n${text}`,
  "fix-grammar": (text) =>
    `Fix any grammar, spelling, or punctuation errors in the following text. Return the corrected version:\n\n${text}`,
  "make-concise": (text) =>
    `Make the following text more concise. Remove redundancy and tighten the prose:\n\n${text}`,
  "rewrite-formal": (text) =>
    `Rewrite the following text in a more formal, academic tone:\n\n${text}`,
  "rewrite-casual": (text) =>
    `Rewrite the following text in a more conversational, accessible tone:\n\n${text}`,
};

export async function POST(request: Request) {
  try {
    const { command, text, context = "" } = await request.json();

    if (!command || !text) {
      return Response.json({ error: "Command and text are required" }, { status: 400 });
    }

    if (!commandPrompts[command as AICommand]) {
      return Response.json({ error: "Invalid command" }, { status: 400 });
    }

    const userPrompt = commandPrompts[command as AICommand](text, context);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const content = message.content[0];
    const result = content.type === "text" ? content.text : "";

    return Response.json({ result });
  } catch (error) {
    console.error("AI write error:", error);
    return Response.json({ error: "AI generation failed" }, { status: 500 });
  }
}
