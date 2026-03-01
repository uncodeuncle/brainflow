import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { PlayCircle } from 'lucide-react';

export const RootNode = memo(({ data }: any) => {
    return (
        <div className="relative group min-w-[250px] max-w-[350px]">
            <div className="bg-gradient-to-br from-white to-slate-50 border border-border rounded-2xl flex flex-col p-6 shadow-sm ring-1 ring-black/5 transition-all group-hover:ring-primary/30 group-hover:shadow-[0_10px_40px_rgba(200,78,24,0.1)]">
                <div className="flex items-start gap-4 mb-2">
                    <div className="w-10 h-10 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center shrink-0">
                        <PlayCircle className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                        <h2 className="text-[17px] font-black tracking-tight text-slate-800 leading-snug line-clamp-3">
                            {data.title}
                        </h2>
                        <span className="text-[11px] text-primary/80 font-medium w-fit bg-primary/5 px-2 py-0.5 rounded-full">✨ 核心逻辑原点</span>
                        {data.chaptersCount > 0 && (
                            <span className="text-[11px] text-muted-foreground ml-1">延展出 {data.chaptersCount} 个主分支结构</span>
                        )}
                    </div>
                </div>
            </div>

            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-primary border-2 border-white right-[-6px]" />
        </div>
    );
});

RootNode.displayName = 'RootNode';
