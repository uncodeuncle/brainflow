import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HistoryCard } from "@/components/HistoryCard";
import { Search } from "lucide-react";

interface HistoryArchiveModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    history: any[];
    editingId: string | null;
    editingTitle: string;
    setEditingTitle: (title: string) => void;
    onStartEdit: (e: React.MouseEvent, id: string, currentTitle: string) => void;
    onSaveEdit: (e: React.MouseEvent, id: string) => void;
    onCancelEdit: (e: React.MouseEvent) => void;
    onClickCard: (id: string) => void;
    onExport: (id: string) => void;
    onDelete: (id: string) => void;
}

export function HistoryArchiveModal({
    isOpen,
    onOpenChange,
    history,
    editingId,
    editingTitle,
    setEditingTitle,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onClickCard,
    onExport,
    onDelete
}: HistoryArchiveModalProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSourceTab, setActiveSourceTab] = useState<"all" | "video" | "local">("all");
    const [activeTimeTab, setActiveTimeTab] = useState<"all" | "today" | "week" | "older">("all");

    const filteredHistory = useMemo(() => {
        let filtered = history;

        // 1. Filter by source tab
        if (activeSourceTab === "video") {
            filtered = filtered.filter(item => !item.isLocal);
        } else if (activeSourceTab === "local") {
            filtered = filtered.filter(item => item.isLocal);
        }

        // 2. Filter by time tab
        if (activeTimeTab !== "all") {
            const now = Date.now();
            const todayStart = new Date().setHours(0, 0, 0, 0);
            const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

            filtered = filtered.filter(item => {
                const itemTime = item.timestamp; // assuming timestamp is ms
                if (activeTimeTab === "today") return itemTime >= todayStart;
                if (activeTimeTab === "week") return itemTime >= sevenDaysAgo;
                if (activeTimeTab === "older") return itemTime < sevenDaysAgo;
                return true;
            });
        }

        // 3. Filter by deep search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item => {
                // Check basic fields
                if ((item.title || "").toLowerCase().includes(query)) return true;
                if ((item.uploader || "").toLowerCase().includes(query)) return true;

                // Check deep content in results if it exists
                if (item.results) {
                    try {
                        const resultsStr = typeof item.results === 'string'
                            ? item.results.toLowerCase()
                            : JSON.stringify(item.results).toLowerCase();
                        if (resultsStr.includes(query)) return true;
                    } catch (e) {
                        // silently ignore parsing errors during search
                    }
                }
                return false;
            });
        }

        return filtered;
    }, [history, activeSourceTab, activeTimeTab, searchQuery]);

    // Click handler wrapper to close modal when opening a reader
    const handleCardClick = (id: string) => {
        onClickCard(id);
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="!w-[95vw] !max-w-6xl h-[85vh] flex flex-col p-8 overflow-hidden rounded-3xl bg-slate-50 border border-white/40 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.12)]">
                <DialogHeader className="mb-2 space-y-6 shrink-0 relative z-10">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-2xl font-extrabold text-slate-800 tracking-tight flex items-center">
                            所有过往笔记
                            <span className="ml-3 text-xs font-semibold text-primary bg-primary/5 px-2.5 py-1 rounded-full border border-primary/10">
                                找到 {filteredHistory.length} 篇
                            </span>
                        </DialogTitle>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pb-4 border-b border-border/40">
                        <div className="flex gap-4 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
                            {/* Source Tabs - Segmented Control */}
                            <div className="flex p-1 bg-slate-100/80 backdrop-blur-sm rounded-xl shrink-0">
                                {[
                                    { id: "all", label: "全部来源" },
                                    { id: "video", label: "视频网站" },
                                    { id: "local", label: "本地上传" }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveSourceTab(tab.id as any)}
                                        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-300 ${activeSourceTab === tab.id
                                            ? "bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_rgba(200,78,24,0.4)]"
                                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Time Tabs - Segmented Control */}
                            <div className="flex p-1 bg-slate-100/80 backdrop-blur-sm rounded-xl shrink-0">
                                {[
                                    { id: "all", label: "全部时间" },
                                    { id: "today", label: "今天" },
                                    { id: "week", label: "近 7 天" },
                                    { id: "older", label: "更早" }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTimeTab(tab.id as any)}
                                        className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-300 ${activeTimeTab === tab.id
                                            ? "bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_rgba(200,78,24,0.4)]"
                                            : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Search Input Polish */}
                        <div className="relative w-full sm:w-72 shrink-0 group">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                            <Input
                                placeholder="搜索笔记标题或内容..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 h-10 bg-slate-100/50 border-transparent shadow-none hover:bg-slate-100 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/20 text-sm rounded-2xl transition-all duration-300"
                            />
                        </div>
                    </div>
                </DialogHeader>

                {/* Scroll Mask overlay */}
                <div className="absolute top-[160px] left-0 right-0 h-4 bg-gradient-to-b from-slate-50 to-transparent pointer-events-none z-10 hidden sm:block"></div>

                <div className="flex-1 overflow-y-auto pr-3 -mr-3 pb-8 relative z-0">
                    {filteredHistory.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                            {filteredHistory.map(item => (
                                <HistoryCard
                                    key={item.jobId}
                                    item={item}
                                    editingId={editingId}
                                    editingTitle={editingTitle}
                                    setEditingTitle={setEditingTitle}
                                    onStartEdit={onStartEdit}
                                    onSaveEdit={onSaveEdit}
                                    onCancelEdit={onCancelEdit}
                                    onClickCard={handleCardClick}
                                    onExport={onExport}
                                    onDelete={onDelete}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                                <Search className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="text-sm font-medium">没有找到相关笔记</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
