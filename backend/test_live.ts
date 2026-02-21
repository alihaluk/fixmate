import { GoogleGenAI, Modality } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });

async function init() {
  try {
    const session = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-latest",
      config: {
        systemInstruction: {
          parts: [{ text: "You are FixMate." }]
        },
        responseModalities: [Modality.AUDIO]
      },
      callbacks: {
        onmessage: () => { },
        onclose: (e) => console.log("Connection closed.", e),
        onerror: (err) => console.error("Socket error", err),
      },
    });
    console.log("Connected successfully to Gemini Live!");
    setTimeout(() => {
      console.log("Connection looks stable!");
      process.exit(0);
    }, 5000);
  } catch (err) {
    console.error("Error connecting:", err);
  }
}
init();
