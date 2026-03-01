import React from 'react';
import { Chapter as IChapter, TermDefinition } from '@/types/brain';
import { CardNode } from './CardNode';

interface CardFlowTimelineProps {
    chapters: IChapter[];
    terms: TermDefinition[];
    isCollection?: boolean;
}

export function CardFlowTimeline({ chapters, terms, isCollection }: CardFlowTimelineProps) {
    if (!chapters || chapters.length === 0) {
        return <p className="text-muted-foreground text-center py-20">暂无结构化大纲数据...</p>;
    }

    return (
        <div className="relative py-8 max-w-4xl mx-auto w-full">
            {/* 贯穿全局的主中轴线 (以防章节间隙断掉，但这里我们拆给每个 Chapter 去做局部中轴会更灵活，目前还是保留一条底色轴) */}
            <div className="absolute left-6 md:left-10 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/5 to-transparent"></div>

            <div className="space-y-12 md:space-y-16 relative">
                {chapters.map((chapter) => (
                    <div key={chapter.id} className="relative group/chapter">

                        {/* 章节大圆点 (根节点) */}
                        <div className="flex items-center gap-4 relative z-10 mb-8">
                            <div className="w-12 h-12 bg-black border border-white/10 rounded-xl flex items-center justify-center shadow-lg shadow-black/50 z-20 shrink-0 relative ml-0 md:ml-4">
                                <div className="w-4 h-4 rounded-sm bg-primary/80 rotate-45 group-hover/chapter:bg-primary transition-colors group-hover/chapter:shadow-[0_0_15px_rgba(251,114,153,0.6)]"></div>
                            </div>
                            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white/90 bg-clip-text">
                                {chapter.title}
                            </h2>
                        </div>

                        {/* 该章节属下的所有卡片节点 (枝叶节点) */}
                        <div className="space-y-6 md:space-y-8 relative pl-10 md:pl-16">
                            {/* 局部的缩进连接线 */}
                            <div className="absolute left-[1.4rem] md:left-[2.9rem] top-[-30px] bottom-8 w-px bg-white/10"></div>

                            {chapter.nodes?.map((node, index) => {
                                const nextNodeRelation = node.relations?.find(r =>
                                    chapter.nodes[index + 1] && r.targetId === chapter.nodes[index + 1].id
                                );

                                return (
                                    <div key={node.id} className="relative flex items-start gap-6 md:gap-8 group/timeline">

                                        {/* 叶子节点的小圆点 */}
                                        <div className="relative z-10 flex flex-col items-center mt-6 -ml-[25px] md:-ml-[29px] shrink-0">
                                            <div className="w-3 h-3 rounded-full bg-background border-[1.5px] border-white/30 flex items-center justify-center group-hover/timeline:border-primary/80 transition-all">
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0 pr-4">
                                            <CardNode node={node} terms={terms} isCollection={isCollection} />

                                            {nextNodeRelation && (
                                                <div className="absolute -bottom-5 md:-bottom-6 left-2 md:left-6 z-20 flex items-center opacity-70 group-hover/timeline:opacity-100 transition-opacity">
                                                    <div className="bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-muted-foreground px-2 py-0.5 rounded-full shadow-sm">
                                                        {nextNodeRelation.label || '推导'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                    </div>
                ))}
            </div>
        </div>
    );
}
