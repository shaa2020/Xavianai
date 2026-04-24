import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

export const BABY_SAFETY_SYSTEM_INSTRUCTION = `
You are Xavian Care AI, a pediatric safety advisor and newborn care assistant.
Your goal is to convert parent speech/text into structured baby care logs and provide immediate, supportive, and safety-first guidance.

BABY INFO:
- Name: Xavian Faris
- Birth Context: September 2025 (Parents will provide updates)

TASKS:
1. Parse input into structured care logs (amount in ml, duration in mins, side for breast).
2. Predict Next Window: "Xavian usually gets hungry every 3 hours. Expect the next feed around [TIME]."
3. Pattern Detection: 
   - If diapers are < 6 in 24h: "Hydration Check: Xavian has had fewer wet diapers today. Monitor closely and feed more frequently if possible."
   - If cry intensity is 4 or 5: "Soothing Needed: Sounds like a tough moment. Have you tried the '5 S's' or a warm compress for gas?"
   - If awake for > 90 mins: "Overtired Alert: Xavian has been awake for a while. He might be hitting an overtired wall soon. Try a dark room and white noise now."
4. Climate Guidance: Based on Sept/Oct weather, suggest clothing: "It's getting cooler. Xavian might need an extra cotton layer or a 1.0 TOG sleep sack tonight."
5. Professional Safety:
   - If Fever > 38C: "CRITICAL: High fever detected. Contact your pediatrician immediately or go to the ER."
   - If breathing difficulties: "CRITICAL: Difficulty breathing is an emergency. Call emergency services now."
   - Medication: "Verify dosage with your doctor before administering any medication."

SAFEGUARD RULES:
- NEVER specify medication dosages.
- Always warn about Safe Sleep (Back, Flat, Empty).
- Tone: Supportive, non-robotic, clear. Explain WHY a suggestion is made.
`;

export async function processCareInput(
  input: string, 
  context: { lastFeeding?: any, lastSleep?: any },
  options?: { apiKey?: string; model?: string }
) {
  let model = options?.model || "gemini-3-flash-preview";
  if (!["gemini-3-flash-preview", "gemini-3.1-pro-preview"].includes(model)) {
    model = "gemini-3-flash-preview";
  }
  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY;
  
  try {
    if (!apiKey) {
      throw new Error("API Key is not defined. Please set it in Settings or Environment.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [{
          text: `
            Parent input: "${input}"
            Context: ${JSON.stringify(context)}
            Current Local Device Time: ${new Date().toLocaleString()} (Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone})
          `
        }]
      }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        systemInstruction: BABY_SAFETY_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { 
              type: Type.STRING, 
              enum: ["feeding", "sleep", "diaper", "health", "behavior", "medication", "general_query"] 
            },
            structuredLog: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                details: { 
                  type: Type.OBJECT,
                  properties: {
                    amount: { type: Type.NUMBER, description: "Milk volume in ml (number only)" },
                    duration: { type: Type.NUMBER, description: "Sleep duration in minutes (number only)" },
                    side: { type: Type.STRING, description: "Breastfeeding side: left, right, or both" },
                    medicationName: { type: Type.STRING, description: "Name of the medication given" },
                    dosage: { type: Type.STRING, description: "The dosage amount given (e.g. 2.5ml)" }
                  }
                },
                note: { type: Type.STRING },
                isSafetyConcern: { type: Type.BOOLEAN }
              }
            },
            aiResponse: { type: Type.STRING },
            safetyAlert: {
              type: Type.OBJECT,
              properties: {
                severity: { type: Type.STRING, enum: ["info", "warning", "critical"] },
                message: { type: Type.STRING }
              }
            },
            suggestedNextAction: { type: Type.STRING },
            reminderInMinutes: { type: Type.NUMBER }
          },
          required: ["intent", "aiResponse"]
        }
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    return JSON.parse(response.text.trim());
  } catch (e: any) {
    console.error("AI Processing Error:", e);
    
    const errorMessage = e.message || String(e);
    
    // Check for rate limit / quota exhaustion
    if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("quota")) {
      return {
        intent: "general_query",
        aiResponse: "API Quota Exceeded. You have used up the current rate limit for the provided Gemini API key. Please switch models or provide a new API key in the Profile Settings.",
        safetyAlert: {
          severity: "warning",
          message: "API Quota Exceeded."
        }
      };
    }

    // Check for Model Not Found
    if (errorMessage.includes("404") || errorMessage.includes("NOT_FOUND") || errorMessage.includes("not found")) {
      return {
        intent: "general_query",
        aiResponse: "The selected AI model could not be found. Please go to Profile Settings and select a different model (like Gemini 1.5 Flash).",
        safetyAlert: {
          severity: "warning",
          message: "Model Not Found."
        }
      };
    }

    // Return a graceful fallback if the AI service is failing for other reasons
    return { 
      intent: "general_query", 
      aiResponse: "I'm having a little trouble thinking clearly right now. It might be a connection issue or an invalid API key. You can update your API key in the Profile screen.",
    };
  }
}
