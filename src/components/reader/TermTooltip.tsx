import React from 'react';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card"

interface TermTooltipProps {
    term: string;
    brief: string;
}

export function TermTooltip({ term, brief }: TermTooltipProps) {
    return (
        <HoverCard openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
                <span className="cursor-help underline decoration-dashed decoration-primary/50 underline-offset-4 hover:decoration-primary hover:text-primary transition-colors">
                    {term}
                </span>
            </HoverCardTrigger>
            <HoverCardContent
                className="w-80 bg-white border-border text-slate-800 text-sm leading-relaxed p-4 shadow-xl shadow-black/5 backdrop-blur-xl animate-in zoom-in-95 rounded-xl"
                sideOffset={8}
            >
                <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/80 inline-block shadow-[0_0_8px_rgba(200,78,24,0.4)]"></span>
                        {term}
                    </h4>
                    <p className="text-slate-500 text-xs leading-5">
                        {brief}
                    </p>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}
