import { useState, useRef, useCallback, useEffect } from 'react';

interface TranscriptItem {
  id: number;
  text: string;
  speakerId?: number;
  isFinal?: boolean;
}

interface UseLiveAudioReturn {
  isRecording: boolean;
  transcriptList: TranscriptItem[];
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearTranscript: () => void;
  restoreTranscript: (list: TranscriptItem[]) => void;
}

export function useLiveAudio(): UseLiveAudioReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptMap, setTranscriptMap] = useState<Record<number, TranscriptItem>>({});
  const [error, setError] = useState<string | null>(null);

  // Persistence: Load on mount
  useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('live-class-transcript-map');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setTranscriptMap(parsed);
        } catch (e) {
          console.error('Failed to load saved transcript', e);
        }
      }
    }
    return null;
  });

  // Persistence: Save on change
  useEffect(() => {
    if (Object.keys(transcriptMap).length > 0) {
       localStorage.setItem('live-class-transcript-map', JSON.stringify(transcriptMap));
    }
  }, [transcriptMap]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Track the most recent sentence ID to handle partials that might miss the ID
  const lastSentenceIdRef = useRef<number>(0);

  const float32ToInt16 = (buffer: Float32Array): Int16Array => {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      // clip
      let f = buffer[l];
      f = f < -1 ? -1 : f > 1 ? 1 : f;
      buf[l] = f < 0 ? f * 0x8000 : f * 0x7fff;
    }
    return buf;
  };

  // Compute array of items for stable DOM rendering
  const transcriptList = Object.entries(transcriptMap)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, item]) => item);

  const stopRecording = useCallback(() => {
    setIsRecording(false);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'finish-task' }));
      setTimeout(() => {
        wsRef.current?.close();
      }, 500);
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const restoreTranscript = useCallback((list: TranscriptItem[]) => {
    const map: Record<number, TranscriptItem> = {};
    list.forEach(item => {
      map[item.id] = item;
    });
    setTranscriptMap(map);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscriptMap({});
      lastSentenceIdRef.current = 0;

      // 1. Get user screen share stream
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = mediaStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('未检测到音频流，请确保在分享屏幕时勾选了"分享声音"。');
      }

      // 2. Setup WebSocket connection
      const wsUrl = `ws://localhost:8081`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[useLiveAudio] Connected to WS proxy');
      };

      ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          
          if (res.payload && res.payload.output && res.payload.output.sentence) {
            const sentence = res.payload.output.sentence;
            
               if (typeof sentence.text === 'string' && sentence.text) {
                  // Aliyun sentence_id is key to preventing duplicates in streaming partials
                  let sId = typeof sentence.sentence_id === 'number' ? sentence.sentence_id : lastSentenceIdRef.current;
                  
                  // If we get a 0 or undefined but have text, and it's a new burst, treat as last known or new
                  if (sId === 0) sId = Date.now(); 
                  lastSentenceIdRef.current = sId;

                  setTranscriptMap(prev => {
                      const newMap = { ...prev };
                      newMap[sId] = {
                        id: sId,
                        text: sentence.text + (sentence.sentence_end ? ' ' : ''),
                        speakerId: sentence.speaker_id, // Capture speaker for diarization
                        isFinal: !!sentence.sentence_end
                      };
                      return newMap;
                  });
               }
          }
        } catch (e) {
          console.error('Failed to parse WS message', event.data);
        }
      };

      ws.onerror = () => {
        setError('WebSocket连接出现错误，请确保 ws-server 正在运行。');
        stopRecording();
      };

      // 3. Setup Audio Processing Pipeline
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioContext;

      const audioOnlyStream = new MediaStream([audioTracks[0]]);
      streamRef.current = audioOnlyStream;

      const source = audioContext.createMediaStreamSource(audioOnlyStream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = float32ToInt16(inputData);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
           wsRef.current.send(pcmData.buffer);
        }
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      setIsRecording(true);
    } catch (err: any) {
      console.warn('[useLiveAudio] stop/cancel/error:', err);
      if (err.name !== 'NotAllowedError' && err.message !== 'Permission denied') {
        setError(err.message || '获取麦克风或屏幕音频失败，请确保授权');
      }
      stopRecording();
    }
  }, [stopRecording]);

  const clearTranscript = useCallback(() => {
    setTranscriptMap({});
    localStorage.removeItem('live-class-transcript-map');
    lastSentenceIdRef.current = 0;
  }, []);

  return { isRecording, transcriptList, error, startRecording, stopRecording, clearTranscript, restoreTranscript };
}
