import React, { useState } from 'react';
import { CardNode as ICardNode, TermDefinition } from '@/types/brain';
import { TermTooltip } from './TermTooltip';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CardNodeProps {
    node: ICardNode;
    terms: TermDefinition[];
    isCollection?: boolean;
}

export function CardNode({ node, terms, isCollection }: CardNodeProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    const renderContentWithTerms = (text: string) => {
        if (!terms || terms.length === 0) return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;

        const sortedTerms = [...terms].sort((a, b) => b.term.length - a.term.length);
        const termRegex = new RegExp(`(${sortedTerms.map(t => t.term.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&')).join('|')})`, 'g');

        const parts = text.split(termRegex);

        return (
            <div className="prose prose-slate prose-p:leading-relaxed prose-pre:bg-slate-50 prose-pre:border-border max-w-none text-sm font-light">
                {parts.map((part, i) => {
                    const matchedTerm = terms.find(t => t.term === part);
                    if (matchedTerm) {
                        return <TermTooltip key={i} term={matchedTerm.term} brief={matchedTerm.brief} />;
                    }
                    return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={{ p: 'span' }}>{part}</ReactMarkdown>;
                })}
            </div>
        );
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'concept': return 'border-blue-500/50';
            case 'conclusion': return 'border-purple-500/50';
            case 'data': return 'border-amber-500/50';
            case 'action': return 'border-green-500/50';
            case 'argument':
            default: return 'border-white/20';
        }
    };

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'concept': return '概念';
            case 'conclusion': return '结论';
            case 'data': return '数据';
            case 'action': return '行动';
            case 'argument': return '论述';
            default: return '节点';
        }
    };

    return (
        <div
            className={`group relative bg-white hover:bg-slate-50/50 border border-border border-l-4 ${getTypeColor(node.type)} rounded-xl p-5 shadow-sm transition-all duration-300 overflow-hidden ${isExpanded ? 'ring-1 ring-border shadow-md' : ''}`}
        >
            <div className="flex justify-between items-start gap-4 cursor-pointer nodrag" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex-1 flex flex-col items-start text-left">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="w-1 h-3 bg-primary rounded-full shrink-0"></div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
                            {getTypeLabel(node.type)}
                        </span>
                        {node.timestamp && (
                            <span className="text-[10px] font-mono text-primary/70">
                                [{node.timestamp}]
                            </span>
                        )}
                    </div>
                    <h3 className="text-base font-medium text-slate-900 leading-snug group-hover:text-primary transition-colors text-left w-full">
                        {node.title}
                    </h3>
                </div>
                <button className="text-slate-400 w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-100 shrink-0 transition-transform mt-1">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
            </div>

            <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'}`}>
                <div className="overflow-hidden min-h-0">
                    <div className="pt-4 border-t border-border space-y-4 text-left">

                        {/* The overview content text */}
                        {node.content && (
                            <div className="text-slate-600">
                                {renderContentWithTerms(node.content)}
                            </div>
                        )}

                        {/* The detailed points list */}
                        {node.detailedPoints && node.detailedPoints.length > 0 && (
                            <ul className="space-y-3 mt-4">
                                {node.detailedPoints.map((dp, idx) => (
                                    <li key={idx} className={`bg-slate-50 p-3 rounded-lg border border-border/50 ${isCollection ? 'space-y-2' : 'flex items-start gap-3'}`}>
                                        <div className={`${isCollection ? 'flex items-start gap-3' : 'contents'}`}>
                                            <span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-2 shrink-0"></span>
                                            <div className="flex-1 text-sm font-light text-slate-700 leading-relaxed text-left">
                                                {renderContentWithTerms(dp.point.replace(/^\s*[-*]\s+/gm, '').replace(/^\d+\.\s+/gm, '').trim())}
                                            </div>
                                            {!isCollection && dp.timestamp && (
                                                <span className="text-[10px] font-mono text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/20 shrink-0 mt-0.5">
                                                    {dp.timestamp}
                                                </span>
                                            )}
                                        </div>
                                        {isCollection && dp.timestamp && (
                                            <div className="text-right">
                                                <span className="text-[10px] font-mono text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/20">
                                                    {dp.timestamp}
                                                </span>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}
