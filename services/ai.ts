
import { GoogleGenAI, Type } from "@google/genai";
import { Article } from "../types";

/**
 * Generates an AI summary for an article.
 * Uses gemini-3-flash-preview for fast text summarization.
 */
export const getSmartSummary = async (article: Article): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a 2-sentence ultra-concise executive summary for the following article content: "${article.content.substring(0, 1000)}"`
    });
    // Use .text property directly as per latest SDK guidelines
    return response.text || "Summary unavailable.";
  } catch (e) {
    console.error("AI Summary failed", e);
    return "Failed to generate AI summary.";
  }
};

/**
 * Predicts importance levels for a batch of article titles.
 * Returns a mapping of title to priority level.
 */
export const predictImportance = async (titles: string[]): Promise<Record<string, 'high' | 'medium' | 'low'>> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Based on these article titles, categorize each as "high", "medium", or "low" priority for an offline reader interested in technology and efficiency. Titles: ${titles.join(', ')}`,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            classifications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  priority: { type: Type.STRING }
                },
                required: ['title', 'priority']
              }
            }
          },
          required: ['classifications']
        }
      }
    });

    const jsonText = response.text || '{}';
    const result = JSON.parse(jsonText);
    const priorityMap: Record<string, 'high' | 'medium' | 'low'> = {};
    
    if (result.classifications && Array.isArray(result.classifications)) {
      result.classifications.forEach((item: any) => {
        priorityMap[item.title] = item.priority;
      });
    }
    
    return priorityMap;
  } catch (e) {
    console.error("AI Importance Prediction failed", e);
    return {};
  }
};
