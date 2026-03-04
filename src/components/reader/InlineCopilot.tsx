"use client";

import React, { useState, useEffect } from 'react';
import { Sparkles, X, Loader2, Clock, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getBasePath } from "@/lib/utils";

interface CopilotQuery {
    id: string;
    text: string;
    context: string;
    result: string;
    isLoading: boolean;
}

export interface InlineCopilotProps {
    jobId?: string;
    initialHistory?: CopilotQuery[];
    updateExternalHistory?: (jobId: string, history: CopilotQuery[]) => Promise<void>;
    externalOpen?: boolean;
    onExternalOpenChange?: (open: boolean) => void;
    globalTopic?: string;
}

export function InlineCopilot({ jobId, initialHistory, updateExternalHistory, externalOpen, onExternalOpenChange, globalTopic }: InlineCopilotProps = {}) {
    const [selectedText, setSelectedText] = useState('');
    const [selectionRect, setSelectionRect] = useState<{ top: number; left: number } | null>(null);
    const [copilotOpen, setCopilotOpen] = useState(externalOpen || false);
    const [contextText, setContextText] = useState('');

    const [activeQuery, setActiveQuery] = useState<CopilotQuery | null>(null);
    const [history, setHistory] = useState<CopilotQuery[]>(initialHistory || []);
    const [drawerMode, setDrawerMode] = useState<'current' | 'history'>('current');

    useEffect(() => {
        if (externalOpen !== undefined && externalOpen !== copilotOpen) {
            setCopilotOpen(externalOpen);
            if (externalOpen && !activeQuery) {
                setSelectionRect(null);
                setDrawerMode('history');
            }
        }
    }, [externalOpen]);

    const handleCopilotOpen = (isOpen: boolean) => {
        setCopilotOpen(isOpen);
        if (onExternalOpenChange) {
            onExternalOpenChange(isOpen);
        }
    };

    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            const text = selection?.toString().trim();

            if (text && text.length > 1 && text.length < 500) {
                const range = selection?.getRangeAt(0);
                const rect = range?.getBoundingClientRect();

                if (rect) {
                    const parentText = range?.commonAncestorContainer?.parentElement?.textContent || '';
                    setSelectedText(text);
                    setContextText(parentText.substring(0, 1000));
                    setSelectionRect({ top: rect.top - 40, left: rect.left + rect.width / 2 });
                }
            } else {
                setSelectionRect(null);
            }
        };

        document.addEventListener('mouseup', handleSelection);
        return () => {
            document.removeEventListener('mouseup', handleSelection);
        };
    }, []);

    const handleCopilotRequest = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (activeQuery && activeQuery.result && !activeQuery.isLoading && !history.find(h => h.id === activeQuery.id)) {
            setHistory(prev => [activeQuery, ...prev]);
        }

        const newQuery: CopilotQuery = {
            id: Date.now().toString(),
            text: selectedText,
            context: contextText,
            result: '',
            isLoading: true
        };

        setActiveQuery(newQuery);
        setSelectionRect(null);
        handleCopilotOpen(true);
        setDrawerMode('current');

        try {
            const response = await fetch(`${getBasePath()}/api/copilot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: newQuery.text,
                    context: newQuery.context,
                    globalTopic
                })
            });

            if (!response.ok) throw new Error('Network error');
            if (!response.body) return;

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                setActiveQuery(prev => prev ? { ...prev, result: prev.result + chunk, isLoading: false } : null);
            }
        } catch (error) {
            console.error(error);
            setActiveQuery(prev => prev ? { ...prev, result: '抱歉，解析遇到了一点问题，请稍后再试。' } : null);
        } finally {
            setActiveQuery(prev => {
                if (prev) {
                    const finishedQuery = { ...prev, isLoading: false };
                    setHistory(prevHistory => {
                        const isExisting = prevHistory.some(h => h.id === finishedQuery.id);
                        if (isExisting) return prevHistory;
                        const next = [finishedQuery, ...prevHistory];
                        if (jobId && updateExternalHistory) {
                            updateExternalHistory(jobId, next);
                        }
                        return next;
                    });
                    return finishedQuery;
                }
                return null;
            });
        }
    };

    const restoreHistory = (item: CopilotQuery) => {
        if (activeQuery && activeQuery.result && !activeQuery.isLoading && !history.find(h => h.id === activeQuery.id)) {
            setHistory(prev => [activeQuery, ...prev]);
        }
        setActiveQuery(item);
        setDrawerMode('current');
    };

    return (
        <>
            {selectionRect && (
                <button
                    onMouseDown={handleCopilotRequest}
                    className="fixed z-[60] flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold rounded-full shadow-md transition-all cursor-pointer border border-primary/20 animate-in fade-in slide-in-from-bottom-2"
                    style={{ top: selectionRect.top, left: selectionRect.left, transform: 'translateX(-50%)' }}
                >
                    <Sparkles size={14} className="animate-pulse" />
                    解释一下
                </button>
            )}

            <div className={`fixed top-0 right-0 h-full w-[400px] bg-white border-l border-border shadow-2xl z-50 transition-transform duration-300 ease-in-out flex flex-col ${copilotOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="flex items-center justify-between p-4 border-b border-border shrink-0 bg-gray-50/80 backdrop-blur-md">
                    <div className="flex items-center gap-2 text-primary overflow-hidden">
                        {drawerMode === 'history' ? (
                            <button onClick={() => setDrawerMode('current')} className="text-muted-foreground hover:text-foreground transition-colors">
                                <ChevronLeft size={18} />
                            </button>
                        ) : (
                            <Sparkles size={18} />
                        )}
                        <h3 className="font-semibold text-sm truncate text-foreground">
                            {drawerMode === 'history' ? 'Copilot 历史记录' : 'Inline Copilot'}
                        </h3>
                    </div>
                    <div className="flex items-center gap-1">
                        {drawerMode === 'current' && history.length > 0 && (
                            <button onClick={() => setDrawerMode('history')} className="text-muted-foreground hover:text-primary p-1.5 rounded-md transition-colors hover:bg-gray-100" title="历史记录">
                                <Clock size={16} />
                            </button>
                        )}
                        <button onClick={() => handleCopilotOpen(false)} className="text-muted-foreground hover:text-foreground p-1.5 rounded-md transition-colors hover:bg-gray-100">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-white">
                    {drawerMode === 'history' ? (
                        <div className="space-y-4">
                            {history.length === 0 && <p className="text-muted-foreground text-sm text-center py-10 font-medium">暂无历史记录</p>}
                            {history.map(item => (
                                <div key={item.id} onClick={() => restoreHistory(item)} className="bg-gray-50 hover:bg-gray-100 border border-border rounded-xl p-4 cursor-pointer transition-colors group shadow-sm">
                                    <p className="text-xs font-semibold text-muted-foreground mb-2 line-clamp-1">"{item.text}"</p>
                                    <p className="text-sm text-foreground/90 line-clamp-2 leading-relaxed group-hover:text-primary transition-colors">{item.result}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        activeQuery ? (
                            <>
                                <div className="bg-gray-50 border border-border rounded-xl p-5 relative shrink-0 shadow-sm mt-3">
                                    <div className="absolute -top-3 left-4 bg-white px-2 text-[11px] text-muted-foreground font-bold uppercase tracking-widest border border-border rounded-full shadow-sm">划选原句</div>
                                    <p className="text-sm font-medium text-foreground/90 leading-relaxed indent-0 mb-0 pt-1">"{activeQuery.text}"</p>
                                </div>

                                <div className="flex-1 text-sm text-foreground/80 leading-relaxed">
                                    {activeQuery.isLoading && !activeQuery.result ? (
                                        <div className="flex items-center gap-3 text-muted-foreground font-medium bg-gray-50 p-4 rounded-xl border border-border w-max animate-pulse">
                                            <Loader2 size={16} className="animate-spin text-primary" />
                                            正在思考并检索最新资料...
                                        </div>
                                    ) : (
                                        <div className="prose prose-slate prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-gray-50 prose-pre:border prose-pre:border-border font-normal">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {activeQuery.result}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
                                <Sparkles size={32} className="mb-4 text-primary/40" />
                                <p className="text-sm font-medium">AI即时解答，哪里不会划哪里</p>
                            </div>
                        )
                    )}
                </div>
            </div>
        </>
    );
}
