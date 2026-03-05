"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, ChevronRight, Download, Share2, Sparkles, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InteractiveFlow } from './reader/InteractiveFlow';
import { TextKnowledgeTree } from './reader/TextKnowledgeTree';
import { InlineCopilot } from './reader/InlineCopilot';
import { AIRawResult } from '@/types/brain';
import { getBasePath } from "@/lib/utils";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";

// 净化 Markdown 符号用于生成左侧纯净大纲预览
const stripMarkdown = (text: string) => {
    if (!text) return "处理中...";
    return text
        .replace(/[#*`>-]/g, "")
        .replace(/\[|\]|\(|\)/g, "")
        .replace(/\n+/g, " ")
        .trim();
};

interface ReaderProps {
    jobId: string;
    onBack: () => void;
    saveResults?: (jobId: string, results: any[]) => Promise<void>;
    initialResults?: any[];
    initialCopilotHistory?: any[];
    updateCopilotHistory?: (jobId: string, history: any[]) => Promise<void>;
    isLocal?: boolean;
}

export function Reader({ jobId, onBack, saveResults, initialResults, initialCopilotHistory, updateCopilotHistory, isLocal }: ReaderProps) {
    const [status, setStatus] = useState<any>(initialResults ? { state: 'completed', result: { results: initialResults } } : null);
    const [activeIndex, setActiveIndex] = useState<number>(0);
    const [viewMode, setViewMode] = useState<'flow' | 'text'>('text');
    const [resultsSaved, setResultsSaved] = useState(false);
    const [copilotOpen, setCopilotOpen] = useState(false);

    // jobId may be composite "bullmqId_timestamp" — extract the real BullMQ ID for API polling
    const realJobId = jobId.includes('_') ? jobId.split('_')[0] : jobId;

    useEffect(() => {
        // If we already have initial results loaded from IndexedDB, we don't need to poll at all.
        if (initialResults) return;

        // Poll for job status
        const interval = setInterval(async () => {
            try {
                // Prevent aggressive browser caching of the API polling
                const res = await fetch(`${getBasePath()}/api/task?id=${realJobId}&t=${Date.now()}`, {
                    cache: 'no-store'
                });
                if (res.status === 404) {
                    setStatus({ state: 'failed', error: '后台任务已清除或失效，且本地无缓存记录。' });
                    clearInterval(interval);
                    return;
                }
                const data = await res.json();
                setStatus(data);

                // Stop polling if complete or failed
                if (data.state === 'completed' || data.state === 'failed') {
                    clearInterval(interval);
                }
            } catch (e) {
                console.error("Polling error", e);
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [jobId, initialResults]);

    // Auto-save complete results to IndexedDB when task finishes
    useEffect(() => {
        if (status?.state === 'completed' && status?.result?.results && saveResults && !resultsSaved) {
            saveResults(jobId, status.result.results);
            setResultsSaved(true);
        }
    }, [status, jobId, saveResults, resultsSaved]);

    const progressPercent = status?.progress?.percent || 0;
    const progressMessage = status?.progress?.message || '初始化任务...';
    const isComplete = status?.state === 'completed';

    // Merged results: use final results if complete, otherwise use streamed partial results from progress
    const activeResults = isComplete ? (status?.result?.results || []) : (status?.progress?.partialResults || []);

    // Default to the original items requested by the user
    let requestedItems = status?.originalData?.items || [];

    // Compute effective display items to support dynamically spawned book chapters (index >= 1000)
    let displayItemsMap = new Map();
    requestedItems.forEach((item: any) => {
        if (item.index !== 0) displayItemsMap.set(item.index, item);
    });
    // Add dynamic chapters and remove their original parent placeholder
    if (activeResults && activeResults.length > 0) {
        activeResults.forEach((r: any) => {
            if (r.index >= 1000) {
                const parentIndex = Math.floor(r.index / 1000);
                displayItemsMap.delete(parentIndex);
                displayItemsMap.set(r.index, { index: r.index, title: r.title });
            }
        });
    }
    const displayItemsArray = Array.from(displayItemsMap.values()).sort((a, b) => a.index - b.index);

    const expectP0 = displayItemsArray.length > 1;
    const p0Result = activeResults.find((r: any) => r.index === 0);

    let currentResult = activeResults.find((r: any) => r.index === activeIndex);
    let resolvedActiveIndex = activeIndex;
    if (!currentResult && activeResults.length > 0) {
        currentResult = p0Result || activeResults[0];
        resolvedActiveIndex = currentResult.index;
    }

    let parsedCurrentResult: any = null;
    if (currentResult?.summary) {
        try {
            parsedCurrentResult = JSON.parse(currentResult.summary);
        } catch {
            // Not JSON
        }
    }
    const currentChapters = parsedCurrentResult?.chapters || currentResult?.chapters || [];
    const currentTerms = parsedCurrentResult?.terms || currentResult?.terms || [];
    const hasStructuredData = currentChapters.length > 0;

    return (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-fade-in">
            {/* Header */}
            <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-white shrink-0">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground">
                        &larr; 返回主页
                    </Button>
                    <div className="h-4 w-[1px] bg-border"></div>
                    <span className="font-bold tracking-tight text-foreground">BrainFlow 阅读器</span>
                    {status?.state === 'active' && (
                        <span className="flex items-center text-xs font-semibold text-primary bg-primary/5 px-2 py-1 rounded-full border border-primary/20 animate-pulse">
                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> 处理中
                        </span>
                    )}
                    {isComplete && (
                        <span className="flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 mr-1.5" /> 处理完成
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" className="hidden border-border hover:bg-gray-50 md:flex" disabled={!isComplete}>
                        <Share2 className="w-4 h-4 mr-2" /> 分享
                    </Button>

                    {isComplete && status?.result?.playlistZipUrl ? (
                        <a href={status.result.playlistZipUrl} download>
                            <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all">
                                <Download className="w-4 h-4 mr-2" /> 闪电下载合集包
                            </Button>
                        </a>
                    ) : (
                        <Button size="sm" className="bg-primary text-primary-foreground opacity-50 cursor-not-allowed" disabled>
                            <Download className="w-4 h-4 mr-2" /> 导出全部
                        </Button>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                <ResizablePanelGroup orientation="horizontal" className="w-full h-full">
                    {/* Left Sidebar: Knowledge Outline */}
                    <ResizablePanel defaultSize="25%" minSize="15%" maxSize="80%" className="border-r border-border bg-gray-50 flex flex-col hidden md:flex h-full">
                        <div className="p-4 border-b border-border bg-white shrink-0">
                            <h2 className="text-xs font-bold text-muted-foreground mb-4 uppercase tracking-widest">知识结构导航</h2>
                            {!isComplete && (
                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs font-semibold text-foreground pb-1">
                                        <span>总进度</span>
                                        <span className="text-primary">{progressPercent}%</span>
                                    </div>
                                    <Progress value={progressPercent} className="h-1.5 bg-gray-200" indicatorClassName="bg-primary" />
                                    <p className="text-xs text-muted-foreground animate-pulse text-center pt-2 font-medium">
                                        {progressMessage}
                                    </p>
                                </div>
                            )}
                        </div>

                        <ScrollArea className="flex-1 p-4 overflow-y-auto bg-gray-50/50">
                            {displayItemsArray.map((item: any) => {
                                const res = activeResults.find((r: any) => r.index === item.index);
                                const isReady = !!res;
                                const isTargetActive = resolvedActiveIndex === item.index;

                                return (
                                    <div key={item.index}
                                        onClick={() => isReady && setActiveIndex(item.index)}
                                        className={`mb-4 rounded-xl p-3 border shadow-sm overflow-hidden relative transition-all ${!isReady ? 'bg-gray-100 border-dashed border-gray-300 opacity-70' :
                                            isTargetActive ? 'bg-white border-primary shadow-[0_5px_15px_rgba(200,78,24,0.1)] cursor-pointer' : 'bg-white border-border hover:border-primary/50 cursor-pointer'
                                            }`}
                                    >
                                        <div className={`flex border-l-[3px] pl-3 py-1 mb-2 group transition-colors justify-between items-center ${isTargetActive ? 'border-primary' : (isReady ? 'border-border group-hover:border-primary/50' : 'border-gray-200')}`}>
                                            <h3 className={`text-sm font-bold transition-colors line-clamp-2 ${isTargetActive ? 'text-primary' : (isReady ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground')}`}>
                                                {item.index >= 1000 ? '' : `P${item.index}: `}
                                                {(() => {
                                                    const pMatch = (res?.title || item.title)?.match(/\bp\d+\s+(.+)$/i);
                                                    return pMatch ? pMatch[1] : (res?.title || item.title);
                                                })()}
                                            </h3>
                                        </div>

                                        {isReady ? (
                                            <>
                                                {res.error ? (
                                                    <p className="text-[13px] text-red-500 leading-relaxed pl-3.5 mb-3">
                                                        ⚠️ {res.error}
                                                    </p>
                                                ) : (
                                                    <p className="text-[13px] text-muted-foreground leading-relaxed pl-3.5 mb-3 line-clamp-3">
                                                        {(() => {
                                                            try {
                                                                const parsed = JSON.parse(res.summary);
                                                                if (parsed.chapters) {
                                                                    return parsed.chapters.map((ch: any) => ch.title).join(' · ');
                                                                }
                                                                return stripMarkdown(res.summary).slice(0, 120);
                                                            } catch {
                                                                return stripMarkdown(res.summary).slice(0, 120);
                                                            }
                                                        })()}
                                                    </p>
                                                )}

                                                {res.videoUrl ? (
                                                    <div className="pl-3.5 mt-2 flex items-center">
                                                        <a
                                                            href={res.videoUrl}
                                                            download={`${res.title}.mp4`}
                                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 rounded-md shadow-sm"
                                                        >
                                                            <Download className="w-3 h-3" />
                                                            下载视频缓存
                                                        </a>
                                                    </div>
                                                ) : res.isVideoDownloading ? (
                                                    <div className="pl-3.5 mt-2 flex items-center">
                                                        <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground bg-gray-50 border border-border rounded-md shadow-sm opacity-80 cursor-not-allowed">
                                                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/70" />
                                                            视频缓存合成中...
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : (
                                            <div className="pl-3.5 pt-1 pb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground animate-pulse">
                                                <Loader2 className="w-3 h-3 animate-spin" /> 正在解析片段中...
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </ScrollArea>

                        {/* 全集总览 P0 区域 - 放置在最底部（固定在 ScrollArea 外部） */}
                        {expectP0 && (
                            <div className="p-4 border-t border-border bg-white shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.02)]">
                                <h2 className="text-xs font-bold text-muted-foreground mb-3 px-1 uppercase tracking-wider flex items-center gap-1">
                                    <span>★</span> {displayItemsArray.some(item => item.index >= 1000) ? '全书精华提炼' : '全集融合归纳'}
                                    <span className="font-normal text-muted-foreground/60 ml-1 normal-case tracking-normal">
                                        — {displayItemsArray.some(item => item.index >= 1000) ? '整合全书核心观点' : '整合合集全部内容'}
                                    </span>
                                </h2>
                                <div
                                    onClick={() => p0Result && setActiveIndex(0)}
                                    className={`rounded-xl p-4 border relative overflow-hidden transition-all shadow-sm ${p0Result ? (resolvedActiveIndex === 0 ? 'bg-primary/5 border-primary shadow-[0_5px_15px_rgba(200,78,24,0.1)] cursor-pointer' : 'bg-white border-border hover:border-primary/50 cursor-pointer')
                                        : 'bg-gray-100 border-dashed border-gray-300 opacity-70'
                                        }`}
                                >
                                    <div className={`flex border-l-[3px] pl-3 py-1 mb-2 transition-colors justify-between items-center ${resolvedActiveIndex === 0 ? 'border-primary' : (p0Result ? 'border-primary/30' : 'border-gray-200')}`}>
                                        <h3 className={`text-sm font-bold transition-colors line-clamp-1 ${resolvedActiveIndex === 0 ? 'text-primary' : (p0Result ? 'text-foreground' : 'text-muted-foreground')}`}>
                                            {p0Result?.title || (displayItemsArray.some(item => item.index >= 1000) ? '全书总览' : '全集总览')}
                                        </h3>
                                    </div>
                                    {p0Result ? (
                                        <>
                                            <p className="text-[12px] text-muted-foreground leading-relaxed pl-4 line-clamp-3">
                                                {p0Result.overview || `整合分析 ${requestedItems.length} 个视角的上下文，生成跨集归纳全景图。`}
                                            </p>
                                        </>
                                    ) : (
                                        <div className="pl-4 pt-1 pb-1 flex items-center gap-2 text-[11px] font-medium text-muted-foreground animate-pulse">
                                            <Loader2 className="w-3 h-3 animate-spin" /> 等待分集处理完毕后生成...
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </ResizablePanel>

                    {/* Draggable Divider */}
                    <ResizableHandle className="bg-border hover:bg-primary/30 transition-colors active:bg-primary z-50 flex items-center justify-center group" />

                    {/* Right Content: Detail View */}
                    <ResizablePanel className="bg-white relative flex flex-col h-full min-w-0">
                        {/* Dot pattern background for light theme */}
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[length:24px_24px] pointer-events-none opacity-50"></div>
                        <InlineCopilot
                            jobId={jobId}
                            initialHistory={initialCopilotHistory}
                            updateExternalHistory={updateCopilotHistory}
                            externalOpen={copilotOpen}
                            onExternalOpenChange={setCopilotOpen}
                            globalTopic={status?.result?.results?.[0]?.title || p0Result?.title || ''}
                        />

                        <div className="h-14 border-b border-border flex items-center px-4 gap-2 bg-gray-50/80 backdrop-blur-md shrink-0 z-10 transition-colors">
                            <div
                                onClick={() => setViewMode('text')}
                                className={`px-4 py-2 rounded-full text-xs font-bold cursor-pointer transition-colors flex items-center gap-2 ${viewMode === 'text' ? 'bg-slate-800 text-white shadow-sm' : 'hover:bg-gray-100 text-muted-foreground hover:text-slate-900'}`}
                            >
                                信息纲要
                            </div>
                            <div
                                onClick={() => setViewMode('flow')}
                                className={`px-4 py-2 rounded-full text-xs font-bold cursor-pointer flex items-center gap-2 transition-colors ${viewMode === 'flow' ? 'bg-slate-800 text-white shadow-sm' : 'hover:bg-gray-100 text-muted-foreground hover:text-slate-900'}`}
                            >
                                逻辑沙盘
                            </div>
                            <div className="flex-1"></div>
                            {status?.result?.formats?.marp && <div className="px-3 py-1.5 rounded-full hover:bg-gray-100 text-[11px] font-bold text-muted-foreground cursor-pointer transition-colors border border-transparent hover:border-border">演示 PPT</div>}
                            {status?.result?.formats?.mermaid && <div className="px-3 py-1.5 rounded-full hover:bg-gray-100 text-[11px] font-bold text-muted-foreground cursor-pointer transition-colors border border-transparent hover:border-border">逻辑导图</div>}
                            <div onClick={() => setCopilotOpen(true)} className="px-3 py-1.5 ml-1 rounded-full hover:bg-primary/10 text-[12px] flex items-center gap-1.5 font-bold text-primary cursor-pointer transition-colors border border-primary/20 bg-primary/5 shadow-sm">
                                <Sparkles className="w-3.5 h-3.5" />
                                Copilot 记录
                            </div>
                        </div>

                        {viewMode === 'flow' ? (
                            <div className="flex-1 h-full w-full relative z-10">
                                {!isComplete && activeResults.length === 0 ? (
                                    <div className={`p-8 md:p-12 lg:p-16 w-full max-w-5xl mx-auto space-y-6 ${status?.state === 'failed' ? '' : 'opacity-30 animate-pulse'}`}>
                                        <div className="h-8 w-3/4 bg-gray-200 rounded-md"></div>
                                        <div className="space-y-3">
                                            <div className="h-4 w-full bg-gray-200 rounded-md"></div>
                                            <div className="h-4 w-full bg-gray-200 rounded-md"></div>
                                            <div className="h-4 w-5/6 bg-gray-200 rounded-md"></div>
                                        </div>
                                        <div className={`h-48 w-full rounded-xl flex flex-col items-center justify-center mt-12 text-center border ${status?.state === 'failed' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-100 border-border text-muted-foreground'}`}>
                                            {status?.state === 'failed' ? (
                                                <>
                                                    <span className="font-bold text-base mb-2">任务读取失败</span>
                                                    <span className="text-sm px-6">{status.error || '解析过程中发生未知错误'}</span>
                                                    <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>返回首页</Button>
                                                </>
                                            ) : (
                                                <span className="font-medium text-sm">解析中...</span>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-full h-full animate-fade-in relative z-10">
                                        {hasStructuredData ? (
                                            <InteractiveFlow
                                                title={currentResult?.title || '知识流内容'}
                                                chapters={currentChapters}
                                                terms={currentTerms}
                                                isCollection={resolvedActiveIndex === 0}
                                            />
                                        ) : (
                                            <div className="p-8 md:p-12 lg:p-16 flex justify-center text-muted-foreground font-medium">
                                                <p>该片段没有生成有效的结构化摘要。</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <ScrollArea className="flex-1 h-full z-10 bg-white">
                                <div className="p-8 md:p-12 lg:p-16 w-full max-w-5xl mx-auto">
                                    {!isComplete && activeResults.length === 0 ? (
                                        <div className={`space-y-6 ${status?.state === 'failed' ? '' : 'opacity-30 animate-pulse'}`}>
                                            <div className="h-8 w-3/4 bg-gray-200 rounded-md"></div>
                                            <div className="space-y-3">
                                                <div className="h-4 w-full bg-gray-200 rounded-md"></div>
                                                <div className="h-4 w-full bg-gray-200 rounded-md"></div>
                                                <div className="h-4 w-5/6 bg-gray-200 rounded-md"></div>
                                            </div>
                                            <div className={`h-48 w-full rounded-xl flex flex-col items-center justify-center mt-12 text-center border ${status?.state === 'failed' ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-100 border-border text-muted-foreground'}`}>
                                                {status?.state === 'failed' ? (
                                                    <>
                                                        <span className="font-bold text-base mb-2">任务读取失败</span>
                                                        <span className="text-sm px-6">{status.error || '解析过程中发生未知错误'}</span>
                                                        <Button variant="outline" size="sm" className="mt-4" onClick={onBack}>返回首页</Button>
                                                    </>
                                                ) : (
                                                    <span className="font-medium text-sm">解析中...</span>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="w-full flex-1 animate-fade-in relative z-10">
                                            {hasStructuredData ? (
                                                <TextKnowledgeTree
                                                    chapters={currentChapters}
                                                    terms={currentTerms}
                                                />
                                            ) : currentResult?.error ? (
                                                <div className="p-8 md:p-12 lg:p-16 flex flex-col items-center gap-4 text-center">
                                                    <p className="text-red-500 font-medium text-base">⚠️ 此片段处理失败</p>
                                                    <p className="text-muted-foreground text-sm max-w-md">{currentResult.error}</p>
                                                </div>
                                            ) : currentResult?.summary ? (
                                                /* Fallback to old markdown view if chapters is not ready yet */
                                                <div className="prose prose-slate max-w-none text-foreground font-normal leading-relaxed p-8 md:p-12 lg:p-16 mx-auto prose-h2:text-2xl prose-h2:font-bold prose-h2:border-b prose-h2:border-border prose-h2:pb-2 prose-h2:mb-6 prose-h3:text-lg prose-h3:font-bold prose-h3:text-primary prose-a:text-primary prose-li:text-[15px] prose-li:text-foreground/90 prose-ul:pl-0 prose-ul:list-none prose-li:pl-0 prose-li:before:content-['-'] prose-li:before:text-primary/60 prose-li:before:font-bold prose-li:before:mr-3 prose-li:flex prose-li:items-start prose-p:text-[15px] prose-p:text-muted-foreground prose-strong:text-foreground [&_li>p]:inline [&_li>p]:mr-2 prose-code:text-[11px] prose-code:font-mono prose-code:text-muted-foreground/60 prose-code:bg-gray-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:border prose-code:border-border/50 prose-code:before:content-none prose-code:after:content-none">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                        {currentResult.summary?.replace(/\n+\s*(?=[\s\`]*\[P\d+\s+[\d:-]+\])/g, '  ')}
                                                    </ReactMarkdown>
                                                </div>
                                            ) : (
                                                <div className="p-8 md:p-12 lg:p-16 flex justify-center text-muted-foreground font-medium">
                                                    <p>未找到该片段的对应文本摘要。</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        )}
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </div>
    );
}
