import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { Message, MessageRole } from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function chatWithGemini(
  messages: Message[],
  modelName: string = "gemini-1.5-flash",
  onToken?: (token: string) => void
) {
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === MessageRole.USER ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history,
    });

    const lastMessage = messages[messages.length - 1];
    
    if (onToken) {
      const result = await chat.sendMessageStream(lastMessage.content);
      let fullText = "";
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        onToken(chunkText);
      }
      return fullText;
    } else {
      const result = await chat.sendMessage(lastMessage.content);
      return result.response.text();
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}
