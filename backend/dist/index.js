import express from "express";
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, Type } from '@google/genai';
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
            model: "gemini-2.5-flash-native-audio-latest",
            config: {
                systemInstruction: {
                    parts: [{ text: "You are FixMate, an AI repair assistant. Keep your answers extremely concise, natural, and conversational as you are speaking in an audio-only format. IMPORTANT: You MUST use the `show_pointing_guide` tool EVERY TIME the user asks you to point out, highlight, or show a specific object. Find the object in the camera feed, calculate its bounding box [ymin, xmin, ymax, xmax] scaled 0-1000, and call the tool simultaneously while you are talking about it. Never refuse to point." }]
                },
                tools: [{
                        functionDeclarations: [{
                                name: "show_pointing_guide",
                                description: "Show a visual pointing guide (bounding box) on the screen to highlight an object the user should look at. Use this when you say 'look at the X on the left' or similar.",
                                parameters: {
                                    type: Type.OBJECT,
                                    properties: {
                                        objectName: {
                                            type: Type.STRING,
                                            description: "Name of the object being pointed at"
                                        },
                                        ymin: {
                                            type: Type.INTEGER,
                                            description: "Top-most Y coordinate [0-1000] of the bounding box"
                                        },
                                        xmin: {
                                            type: Type.INTEGER,
                                            description: "Left-most X coordinate [0-1000] of the bounding box"
                                        },
                                        ymax: {
                                            type: Type.INTEGER,
                                            description: "Bottom-most Y coordinate [0-1000] of the bounding box"
                                        },
                                        xmax: {
                                            type: Type.INTEGER,
                                            description: "Right-most X coordinate [0-1000] of the bounding box"
                                        }
                                    },
                                    required: ["objectName", "ymin", "xmin", "ymax", "xmax"]
                                }
                            }]
                    }],
                responseModalities: [Modality.AUDIO]
            },
            callbacks: {
                onmessage: (data) => {
                    // Log what kind of response we are getting
                    if (data?.serverContent?.modelTurn?.parts) {
                        const hasAudio = data.serverContent.modelTurn.parts.some(p => p.inlineData);
                        const hasText = data.serverContent.modelTurn.parts.some(p => p.text);
                        console.log(`Received model turn: audio=${hasAudio}, text=${hasText}`);
                        if (hasText) {
                            console.log("Text content:", data.serverContent.modelTurn.parts.find(p => p.text)?.text);
                        }
                    }
                    if (data?.toolCall) {
                        console.log("Received root toolCall!", JSON.stringify(data.toolCall));
                    }
                    // Send the raw JSON message back to React
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(data));
                    }
                    // Auto-reply to tool calls to keep the session flowing
                    const calls = [];
                    if (data?.toolCall?.functionCalls) {
                        calls.push(...data.toolCall.functionCalls);
                    }
                    else if (data?.serverContent?.modelTurn?.parts) {
                        for (const part of data.serverContent.modelTurn.parts) {
                            if (part.functionCall)
                                calls.push(part.functionCall);
                        }
                    }
                    if (calls.length > 0) {
                        try {
                            const reply = calls.map(call => ({
                                id: call.id,
                                name: call.name,
                                response: { result: "Displayed on screen" }
                            }));
                            // Send response back
                            setTimeout(() => {
                                try {
                                    liveSession.sendToolResponse({ functionResponses: reply });
                                }
                                catch (e) {
                                    console.error("Failed to call sendToolResponse:", e);
                                }
                            }, 100);
                        }
                        catch (e) {
                            console.error("Failed to reply to tool call:", e);
                        }
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
            // Differentiate between strings (JSON video frames) and binary buffers (Audio)
            if (liveSession) {
                if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) {
                    // It's likely JSON (either natively string or Buffer resembling JSON starting with '{')
                    try {
                        const jsonPayload = JSON.parse(message.toString('utf8'));
                        if (jsonPayload.mimeType && jsonPayload.data) {
                            // Forward the video frame
                            console.log(`Incoming video frame: ${jsonPayload.mimeType}`);
                            liveSession.sendRealtimeInput({
                                media: {
                                    mimeType: jsonPayload.mimeType,
                                    data: jsonPayload.data
                                }
                            });
                        }
                    }
                    catch (e) {
                        console.error("Failed to parse incoming WebSocket JSON message");
                    }
                }
                else if (Buffer.isBuffer(message)) {
                    // Incoming audio chunk from the React frontend mic
                    // console.log("Incoming audio chunk");
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
