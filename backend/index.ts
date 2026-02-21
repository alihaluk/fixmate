import express from "express";
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY environment variable is not set!");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey,
  httpOptions: { apiVersion: "v1alpha" }
});

app.use(cors());
app.use(express.json());

// Basic health check endpoint for Cloud Run
app.get('/health', (req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Version check to verify deployment
app.get('/version', (req: Request, res: Response) => {
  res.status(200).send('FixMate V2 - BidiStream Active');
});

// Create HTTP server
const server = app.listen(port as number, '0.0.0.0', () => {
  console.log(`Backend server listening on port ${port}`);
});

// Setup WebSocket server for Gemini Live API streaming
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws: WebSocket) => {
  console.log('Client connected to WebSocket for Live session.');

  let liveSession: any = null;

  try {
    // 2. Initialize Gemini Live connection through the official SDK
    liveSession = await ai.live.connect({
      model: "gemini-2.5-flash-native-audio-latest",
      config: {
        systemInstruction: {
          parts: [{ text: "You are FixMate, an AI repair assistant. Keep your answers extremely concise, natural, and conversational as you are speaking in an audio-only format." }]
        },
        responseModalities: [Modality.AUDIO]
      },
      callbacks: {
        onmessage: (data) => {
          // Send the raw JSON message back to React
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
          }
        },
        onclose: (e) => {
          console.log("Gemini Live ws closed");
        },
        onerror: (err) => {
          console.error("Gemini Live ws error:", err);
        }
      }
    });

    console.log("Connected to Gemini Live API WebSocket!");

    ws.on('message', (message: Buffer | string) => {
      // Differentiate between strings (JSON video frames) and binary buffers (Audio)
      if (liveSession) {
        if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) {
          // It's likely JSON (either natively string or Buffer resembling JSON starting with '{')
          try {
            const jsonPayload = JSON.parse(message.toString('utf8'));
            if (jsonPayload.mimeType && jsonPayload.data) {
              // Forward the video frame
              liveSession.sendRealtimeInput({
                media: {
                  mimeType: jsonPayload.mimeType,
                  data: jsonPayload.data
                }
              });
            }
          } catch (e) {
            console.error("Failed to parse incoming WebSocket JSON message");
          }
        } else if (Buffer.isBuffer(message)) {
          // Incoming audio chunk from the React frontend mic
          liveSession.sendRealtimeInput({
            media: {
              mimeType: "audio/pcm;rate=16000",
              data: message.toString("base64")
            }
          });
        }
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
      if (liveSession) {
        try { liveSession.close(); } catch (e) { }
      }
    });

  } catch (error) {
    console.error("Failed to initialize Gemini Live session:", error);
    ws.close();
  }
});
