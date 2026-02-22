import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Video, CameraOff, Wrench } from 'lucide-react';
import './App.css';

interface PointingGuide {
  objectName: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  timestamp: number;
}

function App() {
  const [isListening, setIsListening] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pointingGuide, setPointingGuide] = useState<PointingGuide | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Audio streaming refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  // Video streaming refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (cameraActive && videoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true })
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            setCameraError(null);
          }
        })
        .catch(err => {
          console.error("Error accessing camera:", err);
          setCameraError("Camera device not found. Simulating video stream for demo.");
        });
    } else if (!cameraActive && videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }
  }, [cameraActive]);

  // simple WebSocket connection to backend
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = import.meta.env.MODE === 'development'
      ? `${protocol}//${window.location.host}/ws`
      : 'wss://fixmate-backend-101566445954.us-central1.run.app';

    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('Connected to FixMate Backend');
    };

    wsRef.current.onmessage = async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        data = await data.text();
      }
      try {
        const chunk = JSON.parse(data);

        // Extract function calls from root (Gemini Live typical format) or from parts
        const calls = [];
        if (chunk.toolCall?.functionCalls) {
          calls.push(...chunk.toolCall.functionCalls);
        }
        if (chunk.serverContent?.modelTurn?.parts) {
          for (const part of chunk.serverContent.modelTurn.parts) {
            if (part.functionCall) calls.push(part.functionCall);
          }
        }

        // Process any found tool calls
        for (const call of calls) {
          if (call.name === 'show_pointing_guide') {
            const args = call.args;
            if (args) {
              setPointingGuide({
                objectName: args.objectName || 'Object',
                ymin: args.ymin,
                xmin: args.xmin,
                ymax: args.ymax,
                xmax: args.xmax,
                timestamp: Date.now()
              });

              // Clear the box automatically
              setTimeout(() => {
                setPointingGuide(prev => {
                  if (prev && Date.now() - prev.timestamp >= 3900) {
                    return null;
                  }
                  return prev;
                });
              }, 4000);
            }
          }
        }

        if (chunk.serverContent?.modelTurn?.parts) {
          const parts = chunk.serverContent.modelTurn.parts;

          for (const part of parts) {

            // Check for audio data
            if (part.inlineData && part.inlineData.data) {
              const base64 = part.inlineData.data;
              const binaryStr = atob(base64);
              const len = binaryStr.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              const pcm16 = new Int16Array(bytes.buffer);

              // Convert PCM16 to Float32 for Web Audio API
              const float32 = new Float32Array(pcm16.length);
              for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768;
              }

              if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
              }
              const audioCtx = audioContextRef.current;

              if (audioCtx.state === 'suspended') {
                audioCtx.resume();
              }

              // Gemini Live returns 24kHz audio by default
              const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
              audioBuffer.getChannelData(0).set(float32);

              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination);

              const currentTime = audioCtx.currentTime;
              if (nextPlayTimeRef.current < currentTime) {
                nextPlayTimeRef.current = currentTime;
              }
              source.start(nextPlayTimeRef.current);
              nextPlayTimeRef.current += audioBuffer.duration;
            }
          }
        }
      } catch (e) {
        // Silently ignore non-JSON messages or parse errors
      }
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const toggleListening = () => {
    if (!isListening) {
      setIsListening(true);
      // Initialize AudioContext to capture microphone
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      } else if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const audioCtx = audioContextRef.current;

      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        const audioStream = new MediaStream(stream.getAudioTracks());

        if (audioStream.getAudioTracks().length > 0) {
          sourceRef.current = audioCtx.createMediaStreamSource(audioStream);
          // Create processor: bufferSize 4096, 1 intput channel, 1 output channel
          processorRef.current = audioCtx.createScriptProcessor(4096, 1, 1);

          processorRef.current.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              // Send binary PCM chunk to backend
              wsRef.current.send(pcm16.buffer);
            }
          };

          sourceRef.current.connect(processorRef.current);
          processorRef.current.connect(audioCtx.destination);

          // Reset playhead for AI responses
          nextPlayTimeRef.current = 0;
          // Start sending video frames at 1fps
          if (!videoIntervalRef.current) {
            videoIntervalRef.current = setInterval(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN && videoRef.current && canvasRef.current && cameraActive) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  canvas.width = videoRef.current.videoWidth || 640;
                  canvas.height = videoRef.current.videoHeight || 480;
                  ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

                  // Extract base64 JPEG
                  const base64Jpeg = canvas.toDataURL('image/jpeg', 0.5);
                  // Send as JSON object to distinguish from raw binary Audio
                  wsRef.current.send(JSON.stringify({
                    mimeType: "image/jpeg",
                    data: base64Jpeg.split(',')[1] // Remove data:image/jpeg;base64, prefix
                  }));
                }
              }
            }, 1000); // 1 Frame per Second
          }

        } else {
          console.warn("No audio track found in stream");
        }
      }
    } else {
      setIsListening(false);
      // Stop recording
      if (processorRef.current && sourceRef.current) {
        sourceRef.current.disconnect();
        processorRef.current.disconnect();
        processorRef.current = null;
        sourceRef.current = null;
      }
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
    }
  };

  return (
    <div className="app-container">
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {/* Viewfinder Background */}
      <div className="video-container">
        {cameraActive ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="camera-feed" />
            {cameraError && (
              <div className="camera-error-overlay">
                <div className="simulated-grid"></div>
                <p>{cameraError}</p>
              </div>
            )}
          </>
        ) : (
          <div className="camera-off-placeholder">Camera Offline</div>
        )}

        {/* Dynamic Bounding Box Overlay */}
        {pointingGuide && (
          <div
            className="bounding-box glow-effect scale-in"
            style={{
              top: `${(pointingGuide.ymin / 1000) * 100}%`,
              left: `${(pointingGuide.xmin / 1000) * 100}%`,
              height: `${((pointingGuide.ymax - pointingGuide.ymin) / 1000) * 100}%`,
              width: `${((pointingGuide.xmax - pointingGuide.xmin) / 1000) * 100}%`,
            }}
          >
            <span className="bounding-box-label">{pointingGuide.objectName}</span>
          </div>
        )}
      </div>

      {/* Main HUD Interface */}
      <div className="hud-overlay">
        <header className="hud-header">
          <div className="logo">
            <Wrench size={24} color="#00ffcc" />
            <h1>FixMate</h1>
          </div>
          <div className="status-indicator">
            <span className={`dot ${isListening ? 'active' : ''}`}></span>
            {isListening ? 'AI LISTENING' : 'AI STANDBY'}
          </div>
        </header>

        <main className="message-area">
          {/* This area can show subtitles of what the AI is saying */}
          {isListening && <p className="subtitle typing-effect">"Sizi dinliyorum, kameradan detayları inceleyebilirim..."</p>}
        </main>

        <footer className="controls">
          <button
            className={`action-btn ${!cameraActive && 'danger'}`}
            onClick={() => setCameraActive(!cameraActive)}
          >
            {cameraActive ? <Video size={28} /> : <CameraOff size={28} />}
          </button>

          <button
            className={`action-btn main-action ${isListening && 'recording'}`}
            onClick={toggleListening}
          >
            {isListening ? <Mic size={36} color="#000" /> : <MicOff size={36} />}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default App;
