import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CardNode } from '../CardNode';

export const CardFlowNode = memo(({ data }: any) => {
    return (
        <div className="relative group min-w-[320px] max-w-[400px]">
            {/* Target handle connecting from the previous node/chapter */}
            <Handle type="target" position={Position.Left} className="w-3 h-3 bg-slate-200 border-2 border-white left-[-6px] transition-colors group-hover:bg-primary" />

            {/* Render the original visual CardNode component inline */}
            <div className="react-flow__node-inner shadow-sm hover:shadow-md transition-shadow rounded-xl overflow-hidden bg-white">
                <CardNode node={data.node} terms={data.terms} isCollection={data.isCollection} />
            </div>

            {/* Source handle connecting to the next node */}
            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-slate-200 border-2 border-white right-[-6px] transition-colors group-hover:bg-primary" />

            {/* Flow relationship label (rendered if specified) */}
            {data.relationLabel && (
                <div className="absolute top-1/2 -right-8 -translate-y-1/2 translate-x-full z-20 flex items-center opacity-90 pointer-events-none">
                    <div className="bg-white/80 backdrop-blur-md border border-border text-[10.5px] font-medium text-slate-500 px-2.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                        {data.relationLabel}
                    </div>
                </div>
            )}
        </div>
    );
});

CardFlowNode.displayName = 'CardFlowNode';
