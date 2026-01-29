
import { GoogleGenAI } from "@google/genai";
import { Article } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getSmartSummary = async (article: Article): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a 2-sentence ultra-concise executive summary for the following article content: "${article.content.substring(0, 1000)}"`
    });
    return response.text || "Summary unavailable.";
  } catch (e) {
    console.error("AI Summary failed", e);
    return "Failed to generate AI summary.";
  }
};

export const predictImportance = async (titles: string[]): Promise<Record<string, 'high' | 'medium' | 'low'>> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Based on these article titles, categorize each as "high", "medium", or "low" priority for an offline reader interested in technology and efficiency. Return ONLY a valid JSON object where keys are the titles and values are the priority strings. Titles: ${titles.join(', ')}`,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text);
  } catch (e) {
    return {};
  }
};
