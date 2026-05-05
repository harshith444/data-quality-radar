export function openAIProviderFromEnv() {
  const apiKey = process.env.OPENAI_API_KEY;
  return {
    name: "openai",
    enabled: Boolean(apiKey),
    async createCleaningPlan(payload) {
      if (!apiKey) return payload.localPlan;

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          input: [
            {
              role: "system",
              content: "You are a data cleaning planner. Return only valid JSON matching the requested cleaning plan fields. Do not request full data."
            },
            {
              role: "user",
              content: JSON.stringify({
                task: "Create a safe, use-case-aware data cleaning plan.",
                allowedActions: ["rename_header", "trim_whitespace", "standardize_case", "standardize_categories", "convert_type", "impute_null", "drop_column", "remove_duplicates", "flag_outliers"],
                payload
              })
            }
          ],
          text: { format: { type: "json_object" } }
        })
      });

      if (!response.ok) return payload.localPlan;
      const body = await response.json();
      const text = body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text).filter(Boolean).join("\n");
      return text ? JSON.parse(text) : payload.localPlan;
    }
  };
}
