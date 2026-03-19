"use client";

import { useLiveAudio } from "@/hooks/useLiveAudio";
import { Button } from "@/components/ui/button";
import { Play, Square, Mic, MessageSquare, X, Sparkles, Loader2, ArrowLeft, Send } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import OSS from 'ali-oss';
import { useHistory } from "@/hooks/useHistory";
import { getBasePath } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function LiveClassPage() {
  const { isRecording, transcriptList, error, startRecording, stopRecording, clearTranscript, restoreTranscript } = useLiveAudio();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  
  const [question, setQuestion] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [chatHistory, setChatHistory] = useState<{role: 'user'|'assistant', text: string}[]>([]);
  const { addHistory, history, isLoaded } = useHistory();
  const router = useRouter();

  const handleStartRecording = async () => {
    try {
      await startRecording();
      localStorage.setItem('brainflow_live_recording_active', 'true');
    } catch (e) {
      console.error(e);
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    localStorage.setItem('brainflow_live_recording_active', 'false');
  };
  
  // Group transcript items into paragraphs for better readability
  const paragraphs = transcriptList.reduce((acc: any[][], item, idx) => {
    const prevItem = idx > 0 ? transcriptList[idx-1] : null;
    const speakerChanged = item.speakerId !== undefined && item.speakerId !== prevItem?.speakerId;
    
    // Semantic rules for paragraph splitting:
    // 1. Speaker change is always a hard break
    // 2. Sentence finality with punctuation (excluding short bursts)
    const itemText = item.text.trim();
    const isPunctuationEnd = itemText.match(/[。？！.!?]$/);
    
    const currentPara = acc[acc.length - 1] || [];
    const currentParaLength = currentPara.reduce((sum, it) => sum + it.text.length, 0);
    
    let shouldBreak = speakerChanged;
    
    // Only break if the paragraph has meaningful length and we hit a sentence end
    if (!shouldBreak && prevItem?.isFinal && isPunctuationEnd && currentParaLength > 50) {
        shouldBreak = true;
    }
    
    if (acc.length === 0 || shouldBreak) {
      acc.push([item]);
    } else {
      acc[acc.length - 1].push(item);
    }
    return acc;
  }, []);

  // Smart auto-scroll control
  const isUserScrollingTranscript = useRef(false);
  const isUserScrollingChat = useRef(false);

  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const threshold = 100;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isUserScrollingTranscript.current = !atBottom;
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const threshold = 100;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isUserScrollingChat.current = !atBottom;
  }, []);

  // Smart auto-scroll transcript
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      const selection = window.getSelection();
      const isSelecting = selection && selection.toString().length > 0;
      if (!isSelecting && !isUserScrollingTranscript.current) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [transcriptList]);

  // Smart auto-scroll chat
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      const selection = window.getSelection();
      const isSelecting = selection && selection.toString().length > 0;
      if (!isSelecting && !isUserScrollingChat.current) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [chatHistory]);

  // Persistence: Load history on mount or from URL ?id=
  useEffect(() => {
     const searchParams = new URLSearchParams(window.location.search);
     const historyId = searchParams.get('id');
     
     if (historyId && isLoaded && history.length > 0) {
        const item = history.find(h => h.jobId === historyId);
        if (item) {
            if ((item as any).liveChat) {
                 setChatHistory((item as any).liveChat);
            }
            if ((item as any).transcriptList) {
                 restoreTranscript((item as any).transcriptList);
            }
        }
     }

     if (!historyId) {
         // Only load chat if there's an active recording session or it wasn't cleared
         const savedChat = localStorage.getItem('brainflow_live_chat');
         const wasRecording = localStorage.getItem('brainflow_live_recording_active') === 'true';
         
         if (savedChat && wasRecording) {
             try {
                 setChatHistory(JSON.parse(savedChat));
             } catch(e) {}
         } else if (!wasRecording) {
            // New entry: Clear any residue
            setChatHistory([]);
            if (typeof clearTranscript === 'function') clearTranscript();
         }
     }
  }, [isLoaded, history]);

  // Save history on change
  useEffect(() => {
     if (chatHistory.length > 0) {
        localStorage.setItem('brainflow_live_chat', JSON.stringify(chatHistory));
     }
  }, [chatHistory]);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) {
      setSelectedText(sel.toString().trim());
    }
  };

  const handleAskQuestion = async () => {
    if (!question.trim() && !selectedText) return;
    
    const userMsg = question.trim() ? question : '请解释这段话的意思。';
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setQuestion("");
    setIsLoading(true);

    setChatHistory(prev => [...prev, { role: 'assistant', text: "" }]);

    try {
        const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
        // Improved Deduplication Logic: Focus on isFinal and robust overlap removal
        const joinedTranscript = transcriptList.reduce((acc, item) => {
            if (!acc) return item.text;
            
            // Aggressive fuzzy deduplication:
            // Compare normalized versions (no punctuation/spaces) to find overlap
            const normalize = (s: string) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
            const cleanItemText = item.text.replace(/(.{2,})\1+/g, '$1'); // Local stutter removal
            const normAcc = normalize(acc);
            const normItem = normalize(cleanItemText);
            
            let overlapIdx = 0;
            const maxCheck = Math.min(normAcc.length, normItem.length, 20);
            for (let i = 1; i <= maxCheck; i++) {
                if (normAcc.endsWith(normItem.slice(0, i))) {
                    overlapIdx = i;
                }
            }
            
            if (overlapIdx > 2) {
                let originalConsumed = 0;
                let normalizedConsumed = 0;
                while (normalizedConsumed < overlapIdx && originalConsumed < cleanItemText.length) {
                    if (normalize(cleanItemText[originalConsumed])) {
                        normalizedConsumed++;
                    }
                    originalConsumed++;
                }
                return acc + cleanItemText.slice(originalConsumed);
            }

            return acc + cleanItemText;
        }, "");

        const response = await fetch(`${basePath}/api/copilot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: selectedText,
                context: joinedTranscript.slice(-2500), // Sufficient context for AI
                globalTopic: '网课实时辅导',
                question: userMsg
            }),
            signal: AbortSignal.timeout(60000) // 1 min timeout
        });

        if (!response.ok) throw new Error('网络请求失败');
        
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (reader) {
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    setChatHistory(prev => {
                        const newHistory = [...prev];
                        const lastIndex = newHistory.length - 1;
                        newHistory[lastIndex] = {
                            ...newHistory[lastIndex],
                            text: newHistory[lastIndex].text + chunk
                        };
                        return newHistory;
                    });
                }
            }
        }
    } catch (e) {
        console.error(e);
        setChatHistory(prev => {
            const newHistory = [...prev];
            newHistory[newHistory.length - 1].text = "抱歉，由于网络或API原因，请求失败。";
            return newHistory;
        });
    } finally {
        setIsLoading(false);
        setSelectedText("");
    }
  };

  const handleGenerateSummary = async () => {
    // Deduplicate transcript list before joining using same aggressive logic
    const joinedTranscript = transcriptList.reduce((acc, item) => {
        if (!acc) return item.text;
        const normalize = (s: string) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
        const cleanItemText = item.text.replace(/(.{2,})\1+/g, '$1');
        const normAcc = normalize(acc);
        const normItem = normalize(cleanItemText);
        
        let overlapIdx = 0;
        const maxCheck = Math.min(normAcc.length, normItem.length, 20);
        for (let i = 1; i <= maxCheck; i++) {
            if(normAcc.endsWith(normItem.slice(0, i))) overlapIdx = i;
        }
        
        if (overlapIdx > 2) {
            let originalConsumed = 0;
            let normalizedConsumed = 0;
            while (normalizedConsumed < overlapIdx && originalConsumed < cleanItemText.length) {
                if (normalize(cleanItemText[originalConsumed])) normalizedConsumed++;
                originalConsumed++;
            }
            return acc + cleanItemText.slice(originalConsumed);
        }
        return acc + cleanItemText;
    }, "");

    const fullText = joinedTranscript;
    if (fullText.length < 50) {
        alert("课堂记录内容过短（不足50字），无法生成有效总结。");
        return;
    }
    
    setIsSummarizing(true);
    try {
        const tokenRes = await fetch(`${getBasePath()}/api/oss-sts`);
        if (!tokenRes.ok) throw new Error('无法获取阿里云直传授权');
        const tokenData = await tokenRes.json();
        
        const client = new OSS({
            region: tokenData.region,
            accessKeyId: tokenData.AccessKeyId,
            accessKeySecret: tokenData.AccessKeySecret,
            stsToken: tokenData.SecurityToken,
            bucket: tokenData.bucket,
            secure: true,
        });

        const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        const file = new File([blob], `课堂记录_${new Date().toLocaleDateString()}.txt`, { type: 'text/plain' });
        const objectName = `brainflow-raw/${Date.now()}-${Math.random().toString(36).substring(7)}/${file.name}`;
        
        await client.multipartUpload(objectName, file, {});
        const ossUrl = `oss://${tokenData.bucket}/${objectName}`;

        const analyzeData = {
          title: `网课精华总结: ${new Date().toLocaleString()}`,
          uploader: 'BrainFlow Live Class',
          thumbnail: '',
          isLocal: true,
          entries: [{
            index: 1,
            page: 1,
            title: "实时课堂逐字稿",
            duration: 0,
            localOssUrl: ossUrl
          }]
        };

        // Fix: Include 'items' and 'formats' to pass API validation in task/route.ts
        // Core Fix: Add localOssUrl to items so worker can fetch text
        const payload = { 
          url: 'local_multi_upload', 
          type: 'local', 
          rawData: analyzeData,
          items: [{ index: 1, title: '实时课堂逐字稿', localOssUrl: ossUrl }], 
          formats: { markdown: true, marp: false, mermaid: true, downloadVideo: false }
        };

        const res = await fetch(`${getBasePath()}/api/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        
        if (res.ok) {
            const uniqueJobId = data.jobId; 
            addHistory({
                jobId: uniqueJobId,
                title: analyzeData.title,
                uploader: analyzeData.uploader,
                thumbnail: analyzeData.thumbnail,
                isLocal: true,
                type: 'live-class',
                liveChat: chatHistory,
                transcriptList: transcriptList
            });

            // Cleanup local state
            if (typeof clearTranscript === 'function') clearTranscript();
            localStorage.removeItem('brainflow_live_chat');
            setChatHistory([]);
            
            // Redirection Fix: Remove manual getBasePath() to prevent double prefix 404
            router.push(`/?jobId=${uniqueJobId}`);
        } else {
            throw new Error(data.error || "提交流程失败");
        }
    } catch(e: any) {
        console.error("生成总结失败:", e);
        alert("无法生成总结: " + (e.message || String(e)));
    } finally {
        setIsSummarizing(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#FAF9F6] font-sans selection:bg-primary/20 selection:text-primary">
      
      {/* ─── Header ─── */}
      <header className="h-14 border-b border-border/60 flex items-center justify-between px-6 bg-white/80 backdrop-blur-md shrink-0 z-30">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/`)} className="text-muted-foreground hover:text-foreground h-8 px-2 rounded-lg">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> 返回主页
          </Button>
          <div className="h-4 w-[1px] bg-border/60"></div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shadow-inner">
               <Mic className="w-4 h-4 text-primary" />
            </div>
            <h1 className="font-bold text-sm tracking-tight text-foreground">网课实时助手</h1>
          </div>
          {isRecording && (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full border border-emerald-100/50">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[11px] font-bold text-emerald-600/80 uppercase tracking-widest">Live Syncing</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!isRecording && transcriptList.length > 0 && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={handleGenerateSummary} 
              disabled={isSummarizing} 
              className="border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/40 rounded-full h-8 px-4 text-xs font-semibold"
            >
              {isSummarizing ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
              存入知识库
            </Button>
          )}
          
          {isRecording ? (
            <Button size="sm" onClick={handleStopRecording} className="bg-red-500 hover:bg-red-600 text-white rounded-full h-8 px-4 shadow-sm text-xs font-bold border-0">
              <Square className="w-3.5 h-3.5 mr-2 fill-current" /> 停止捕获
            </Button>
          ) : (
            <Button size="sm" onClick={handleStartRecording} className="bg-primary hover:bg-primary/90 text-white rounded-full h-8 px-4 shadow-sm hover:shadow-md transition-all text-xs font-bold border-0">
              <Play className="w-3.5 h-3.5 mr-2 fill-current" /> 开始捕获
            </Button>
          )}
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <div className="flex-1 flex min-h-0 relative">
        
        {/* Left: Transcript */}
        <div className="flex-1 flex flex-col min-w-0 bg-white shadow-[inset_-1px_0_0_rgba(0,0,0,0.03)]">
          <div className="h-10 border-b border-border/40 flex items-center justify-between px-5 bg-gray-50/40 shrink-0">
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-1.5 rounded-full ${isRecording ? 'bg-emerald-500' : 'bg-gray-300'}`}></div>
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">实时逐字稿流</h2>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground/60">{transcriptList.length > 0 ? `${transcriptList.map(t => t.text).join('').length} 字` : '等待中'}</span>
          </div>
          
          <div 
            ref={transcriptRef}
            onScroll={handleTranscriptScroll}
            onMouseUp={handleMouseUp}
            className="flex-1 overflow-y-auto p-8 md:p-12 select-text cursor-text scrollbar-thin scroll-smooth"
            style={{ overscrollBehavior: 'contain' }}
          >
            {transcriptList.length === 0 && !isRecording ? (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                <Mic className="w-10 h-10 text-primary mb-6 stroke-[1.5]" />
                <p className="text-foreground font-bold text-lg mb-3">开启智慧课堂</p>
                <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
                  点击右上方「开始捕获」，并在弹出的系统窗口中选择“浏览器标签页”并勾选“分享声音”。
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto">
                <article className="space-y-8 select-text cursor-text">
                  {paragraphs.map((pItems: any[], pIdx: number) => {
                    const firstItem = pItems[0];
                    return (
                      <div key={`p-${pIdx}`} className="group relative">
                        {firstItem.speakerId !== undefined && (
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/5 rounded border border-primary/10 uppercase tracking-widest leading-none">
                              发言人 {firstItem.speakerId}
                            </span>
                          </div>
                        )}
                        <p className="text-[17px] leading-[2.1] text-foreground/90 font-normal tracking-tight break-words">
                          {pItems.map((item) => (
                            <span key={item.id} className="transition-opacity duration-300 animate-in fade-in">
                              {item.text}
                            </span>
                          ))}
                        </p>
                      </div>
                    );
                  })}
                </article>
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Assistant */}
        <div className="w-[400px] lg:w-[440px] flex flex-col bg-[#FAF9F6] shrink-0 min-h-0 z-10 border-l border-border/40 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
          <div className="h-10 border-b border-border/40 flex items-center px-5 bg-white shrink-0">
            <Sparkles className="w-3.5 h-3.5 mr-2.5 text-primary stroke-[2]" />
            <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">AI 智慧解读</h2>
          </div>
          
          <div 
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className="flex-1 overflow-y-auto px-6 py-6 space-y-8 scrollbar-thin"
            style={{ overscrollBehavior: 'contain' }}
          >
            {chatHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 opacity-50">
                <div className="w-10 h-10 rounded-2xl bg-primary/5 flex items-center justify-center mb-5">
                   <MessageSquare className="w-5 h-5 text-primary/60" />
                </div>
                <p className="text-foreground font-bold text-sm mb-2">遇到难点？划线提问</p>
                <p className="text-muted-foreground text-[11px] leading-relaxed max-w-[200px]">
                  左侧逐字稿支持选中提问。AI 将深度结合老师的上下文为你实时答疑。
                </p>
              </div>
            ) : (
              chatHistory.map((chat, idx) => (
                <div key={idx} className={`animate-in fade-in slide-in-from-bottom-2 duration-400 group`}>
                  <div className="flex items-center gap-2 mb-3">
                     {chat.role === 'user' ? (
                       <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">ME</div>
                     ) : (
                       <div className="w-5 h-5 rounded-md bg-indigo-500/10 flex items-center justify-center text-[10px] font-bold text-indigo-500"><Sparkles className="w-3 h-3" /></div>
                     )}
                     <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">{chat.role === 'user' ? '我的提问' : 'AI 助教解答'}</span>
                  </div>
                  
                  <div className={`p-5 rounded-2xl border transition-all ${
                    chat.role === 'user' 
                      ? 'bg-white border-primary/10 shadow-[0_4px_12px_rgba(200,78,24,0.03)]' 
                      : 'bg-white border-border/60 shadow-sm'
                  }`}>
                    {chat.role === 'assistant' ? (
                      <div className="prose prose-sm prose-slate max-w-none prose-p:text-foreground/90 prose-p:text-[14px] prose-p:leading-[1.8] prose-li:text-[14px] prose-strong:text-foreground font-normal">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{chat.text || '正在思考中...'}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-[14px] text-foreground font-medium leading-[1.7]">{chat.text}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Selection & Input */}
          <div className="p-6 bg-white border-t border-border/40 shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]">
            {selectedText && (
              <div className="mb-4 bg-primary/5 border border-primary/10 rounded-xl p-4 relative pr-12 animate-in zoom-in-95">
                <div className="absolute -top-2.5 left-4 bg-white border border-primary/20 px-2 py-0.5 rounded-full text-[10px] font-bold text-primary uppercase tracking-widest shadow-sm">选中文段</div>
                <p className="text-[12px] text-foreground/80 leading-[1.6] line-clamp-3 font-medium indent-0 italic">
                  "{selectedText}"
                </p>
                <button onClick={() => setSelectedText("")} className="absolute right-3 top-3.5 p-1.5 hover:bg-primary/20 rounded-full transition-colors text-primary/40 hover:text-primary">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="group flex items-center gap-2 bg-[#FAF9F6] rounded-2xl border border-border/60 p-2 pl-5 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/5 transition-all">
              <input
                className="flex-1 bg-transparent border-0 py-2.5 text-sm text-foreground font-medium placeholder:text-muted-foreground/40 focus:outline-none"
                placeholder={selectedText ? "针对这段话提问..." : "例：刚才这个知识点能详细解释下吗？"}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskQuestion();
                }}
                disabled={isLoading}
              />
              <Button 
                size="icon" 
                onClick={handleAskQuestion} 
                disabled={isLoading} 
                className="h-10 w-10 rounded-xl bg-primary hover:bg-primary/90 text-white shrink-0 shadow-lg shadow-primary/20 transition-transform active:scale-95 flex items-center justify-center p-0"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
