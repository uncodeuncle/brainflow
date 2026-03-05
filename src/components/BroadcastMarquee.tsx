"use client";

import React, { useEffect, useState } from "react";
import { getBasePath } from "@/lib/utils";
import { Bell } from "lucide-react";

interface BroadcastMessage {
    id: number;
    msg: string;
}

export function BroadcastMarquee() {
    const [messages, setMessages] = useState<BroadcastMessage[]>([]);

    useEffect(() => {
        // Fetch the public json file, attach timestamp to prevent caching
        fetch(`${getBasePath()}/broadcast.json?t=${new Date().getTime()}`)
            .then((res) => {
                if (!res.ok) throw new Error("Broadcast file not found");
                return res.json();
            })
            .then((data: BroadcastMessage[]) => {
                if (Array.isArray(data) && data.length > 0) {
                    setMessages(data);
                }
            })
            .catch((err) => {
                // Silently fail if file is missing or invalid, banner simply won't show
                console.log("No active broadcast or failed to load:", err.message);
            });
    }, []);

    if (messages.length === 0) return null;

    return (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 text-primary-foreground/80 px-4 pl-3 py-1.5 rounded-full shadow-sm backdrop-blur-md overflow-hidden max-w-xs md:max-w-md w-full">
            <Bell className="w-4 h-4 text-primary shrink-0 animate-pulse" />
            <div className="flex-1 overflow-hidden flex items-center h-5 relative">
                <div
                    className="flex whitespace-nowrap w-max items-center text-[13px] font-medium text-primary cursor-default hover:[animation-play-state:paused]"
                    style={{ animation: 'marquee 25s linear infinite' }}
                >
                    {messages.map((m) => (
                        <span key={m.id} className="mx-4">
                            {m.msg}
                        </span>
                    ))}
                    {/* Duplicate for seamless infinite scrolling */}
                    {messages.map((m) => (
                        <span key={`dup-${m.id}`} className="mx-4">
                            {m.msg}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
