"use client";

import React from 'react';
import { Chapter as IChapter, TermDefinition } from '@/types/brain';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TermTooltip } from './TermTooltip';

interface TextKnowledgeTreeProps {
    globalTitle?: string;
    chapters: IChapter[];
    terms: TermDefinition[];
}

export function TextKnowledgeTree({ globalTitle, chapters, terms }: TextKnowledgeTreeProps) {
    if (!chapters || chapters.length === 0) {
        return <p className="text-muted-foreground text-center py-20">暂无结构化大纲数据...</p>;
    }

    const formatTimestamp = (ts?: string) => {
        if (!ts) return '';
        // Convert P1001, P1002 etc. to "第1章", "第2章" for readability
        return ts.replace(/P(\d{4,})/g, (match, p1) => {
            const index = parseInt(p1, 10);
            const chapterNum = index % 1000;
            return `第${chapterNum}章`;
        });
    };

    const renderContentWithTerms = (text: string) => {
        if (!terms || terms.length === 0) return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: 'span' }}>{text}</ReactMarkdown>;

        const sortedTerms = [...terms].sort((a, b) => b.term.length - a.term.length);
        const termRegex = new RegExp(`(${sortedTerms.map(t => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');

        const parts = text.split(termRegex);

        return (
            <div className="inline">
                {parts.map((part, i) => {
                    const matchedTerm = terms.find(t => t.term === part);
                    if (matchedTerm) {
                        return <TermTooltip key={i} term={matchedTerm.term} brief={matchedTerm.brief} />;
                    }
                    return <span key={i}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: 'span' }}>{part}</ReactMarkdown></span>;
                })}
            </div>
        );
    };

    return (
        <div className="py-8 px-6 max-w-4xl mx-auto w-full prose prose-slate prose-p:leading-relaxed prose-pre:bg-gray-50 prose-pre:border-border font-normal">
            {globalTitle && (
                <div className="mb-12">
                    <h1 className="text-3xl md:text-3xl font-extrabold tracking-tight text-foreground mb-4">{globalTitle}</h1>
                    <div className="w-20 h-1 bg-primary rounded-full mb-8"></div>
                </div>
            )}

            {chapters.map((chapter) => (
                <div key={chapter.id} className="mb-12">
                    <h2 className="text-2xl font-bold tracking-tight text-foreground mb-6 border-b border-border pb-2">
                        {chapter.title}
                    </h2>

                    <div className="space-y-8 pl-4 border-l-2 border-border/60">
                        {chapter.nodes?.map((node) => (
                            <div key={node.id} className="relative">
                                <h3 className="text-lg font-bold text-primary mt-0 mb-2 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-primary/80 absolute -left-[21px] top-2.5"></span>
                                    {node.title}
                                    {node.timestamp && (
                                        <span className="text-xs font-mono text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded ml-2">
                                            {formatTimestamp(node.timestamp)}
                                        </span>
                                    )}
                                </h3>

                                {node.content && (
                                    <div className="text-muted-foreground mb-4 text-[15px] mt-2 leading-relaxed">
                                        {renderContentWithTerms(node.content)}
                                    </div>
                                )}

                                {node.detailedPoints && node.detailedPoints.length > 0 && (
                                    <ul className="space-y-2 mt-4 list-none pl-0">
                                        {node.detailedPoints.map((dp, idx) => (
                                            <li key={idx} className="flex items-start gap-3 mt-2 text-[15px] text-foreground/90">
                                                <span className="text-primary/60 mt-1 select-none shrink-0 font-bold">-</span>
                                                <div className="flex-1 leading-relaxed">
                                                    {renderContentWithTerms(dp.point)}
                                                    {dp.timestamp && (
                                                        <span className="text-[11px] font-mono text-muted-foreground/60 ml-2 inline-block bg-gray-50 px-1 rounded border border-border/50">
                                                            [{formatTimestamp(dp.timestamp)}]
                                                        </span>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
