import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

export const ChapterNode = memo(({ data }: any) => {
    return (
        <div className="relative group min-w-[200px]">
            <Handle type="target" position={Position.Left} className="opacity-0 w-full h-full absolute inset-0 rounded-xl" />

            <div className="bg-white border border-border rounded-2xl flex items-center justify-center p-6 shadow-sm ring-1 ring-black/5 transition-all group-hover:ring-primary/30 group-hover:shadow-[0_10px_30px_rgba(200,78,24,0.1)]">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-50 border border-border rounded-xl flex items-center justify-center shrink-0">
                        <div className="w-4 h-4 rounded-sm bg-primary/80 rotate-45 group-hover:bg-primary transition-colors group-hover:shadow-[0_0_15px_rgba(200,78,24,0.4)] animate-pulse-slow"></div>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold tracking-tight text-slate-800">
                            {data.title}
                        </h2>
                        {data.nodesCount > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">包含 {data.nodesCount} 个核心逻辑点</p>
                        )}
                    </div>
                </div>
            </div>

            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-white right-[-6px]" />
        </div>
    );
});

ChapterNode.displayName = 'ChapterNode';
