import express from "express";
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
const ai = new GoogleGenAI({ apiKey });
app.use(cors());
app.use(express.json());
// Basic health check endpoint for Cloud Run
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});
// Version check to verify deployment
app.get('/version', (req, res) => {
    res.status(200).send('FixMate V2 - BidiStream Active');
});
// Create HTTP server
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server listening on port ${port}`);
});
// Setup WebSocket server for Gemini Live API streaming
const wss = new WebSocketServer({ server });
wss.on('connection', async (ws) => {
    console.log('Client connected to WebSocket for Live session.');
    let liveSession = null;
    try {
        // 2. Initialize Gemini Live connection through the official SDK
        liveSession = await ai.live.connect({
            model: "gemini-2.0-flash-exp",
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
        ws.on('message', (message) => {
            // Incoming audio chunk from the React frontend mic
            if (liveSession) {
                liveSession.sendRealtimeInput([{
                        mimeType: "audio/pcm;rate=16000",
                        data: message.toString("base64")
                    }]);
            }
        });
        ws.on('close', () => {
            console.log('Client disconnected');
            if (liveSession) {
                try {
                    liveSession.close();
                }
                catch (e) { }
            }
        });
    }
    catch (error) {
        console.error("Failed to initialize Gemini Live session:", error);
        ws.close();
    }
});
