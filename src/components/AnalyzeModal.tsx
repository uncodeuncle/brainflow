import { useState, useEffect } from "react";
import { Check, FileText, Presentation, GitBranch, GitMerge, Download, PlayCircle, Loader2, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function AnalyzeModal({ isOpen, onOpenChange, data, onConfirm }: any) {
    const [selectedFormat, setSelectedFormat] = useState({
        markdown: true,
        marp: false,
        mermaid: false,
        downloadVideo: false,
    });
    const [selectedItems, setSelectedItems] = useState<number[]>([]);
    const [displayEntries, setDisplayEntries] = useState<any[]>([]);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    useEffect(() => {
        if (data && data.entries) {
            setSelectedItems(data.entries.map((e: any) => e.index));
            setDisplayEntries(data.entries);
        }
    }, [data]);

    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggingId(id);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        if (!draggingId || draggingId === targetId) {
            setDraggingId(null);
            return;
        }

        setDisplayEntries(prev => {
            const oldIndex = prev.findIndex(item => item.index.toString() === draggingId);
            const newIndex = prev.findIndex(item => item.index.toString() === targetId);
            if (oldIndex === -1 || newIndex === -1) return prev;

            const newEntries = [...prev];
            const [movedItem] = newEntries.splice(oldIndex, 1);
            newEntries.splice(newIndex, 0, movedItem);
            return newEntries;
        });
        setDraggingId(null);
    };

    const toggleItem = (index: number) => {
        setSelectedItems(prev =>
            prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
        );
    };

    if (!data) return null;

    const handleStart = () => {
        // Filter out unchecked items but preserve the dragged display order
        const orderedSelectedEntries = displayEntries.filter(e => selectedItems.includes(e.index));
        // Crucial: Remap the logical 'index' to respect the new physical order (1, 2, 3...)
        const remappedItems = orderedSelectedEntries.map((e, idx) => ({ ...e, index: idx + 1 }));

        onConfirm({
            formats: selectedFormat,
            items: remappedItems,
            rawData: data
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[90vw] md:max-w-[800px] border-0 bg-white rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] p-0 overflow-hidden flex flex-col">

                <div className="flex flex-col md:flex-row h-[60vh] md:h-[500px]">
                    {/* Left Panel: Video Info & Selected Items */}
                    <div className="w-full md:w-3/5 border-r border-border p-6 flex flex-col bg-gray-50/50 overflow-hidden">
                        <DialogHeader className="mb-4 shrink-0">
                            <DialogTitle className="text-xl font-bold text-foreground">
                                {data.isPlaylist ? "合集解析完成" : "单个视频解析完成"}
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                                请确认待解析内容的选项，并选择你需要的笔记格式。
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex items-start gap-4 mb-6 shrink-0">
                            <div className="relative w-24 h-16 rounded-md overflow-hidden border border-border/50 shadow-sm flex-shrink-0 animate-fade-in group bg-gray-100">
                                {data.thumbnail ? (
                                    <img src={data.thumbnail} alt="cover" className="object-cover w-full h-full transform group-hover:scale-110 transition duration-500" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <PlayCircle className="text-muted-foreground/30" />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition"></div>
                            </div>
                            <div className="flex flex-col justify-center overflow-hidden">
                                <h3 className="font-semibold text-sm text-foreground truncate">{data.title}</h3>
                                <p className="text-xs text-muted-foreground mt-1 truncate">UP主: {data.uploader || '未知'}</p>
                                {data.isPlaylist && (
                                    <span className="inline-block px-2 py-0.5 mt-2 bg-primary/10 text-primary font-medium text-[10px] rounded-full w-max">
                                        共 {data.entries?.length || 0} 个分P
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col min-h-0 -mx-4 px-4 overflow-hidden">
                            <div className="flex items-center justify-between py-2 m-0 shrink-0">
                                <h3 className="font-medium text-sm text-foreground">选择要解析的内容：</h3>
                                <div className="flex items-center gap-3 text-xs font-medium">
                                    <button
                                        className="text-primary hover:text-primary/80 transition-colors"
                                        onClick={() => setSelectedItems(data.entries.map((e: any) => e.index))}
                                    >
                                        全选
                                    </button>
                                    <button
                                        className="text-muted-foreground hover:text-foreground transition-colors"
                                        onClick={() => setSelectedItems([])}
                                    >
                                        反选
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto pr-2 pb-4 space-y-2 mt-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 transition-all">
                                {displayEntries.map((item: any, mapIndex: number) => (
                                    <div
                                        key={item.index}
                                        onClick={() => toggleItem(item.index)}
                                        draggable="true"
                                        onDragStart={(e) => handleDragStart(e, item.index.toString())}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, item.index.toString())}
                                        onDragEnd={() => setDraggingId(null)}
                                        className={cn(
                                            "flex items-center p-3 rounded-xl border cursor-pointer transition-all shadow-sm",
                                            selectedItems.includes(item.index)
                                                ? "border-primary bg-primary/5"
                                                : "border-border bg-white hover:border-primary/50",
                                            draggingId === item.index.toString() ? 'opacity-50 border-dashed scale-[0.98]' : ''
                                        )}
                                    >
                                        <div
                                            className="mr-3 shrink-0 text-primary cursor-grab active:cursor-grabbing hover:bg-primary/10 p-1 rounded-md transition-colors"
                                            onClick={(e) => e.stopPropagation()} // Prevent toggling selection when gripping
                                        >
                                            <GripVertical className="w-4 h-4" />
                                        </div>
                                        <div className={cn(
                                            "w-5 h-5 rounded-full border flex items-center justify-center mr-3 shrink-0 transition-colors",
                                            selectedItems.includes(item.index) ? "border-primary bg-primary" : "border-muted-foreground/50"
                                        )}>
                                            {selectedItems.includes(item.index) && <Check className="w-3 h-3 text-primary-foreground" />}
                                        </div>
                                        <span className="text-sm font-medium text-foreground line-clamp-1">{`P${mapIndex + 1}: ${item.title}`}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Options & Actions */}
                    <div className="w-full md:w-2/5 p-6 flex flex-col justify-between overflow-y-auto bg-white">
                        <div>
                            <h4 className="text-xs font-bold text-muted-foreground mb-6 uppercase tracking-wider">输出偏好设置</h4>
                            <div className="space-y-6">

                                <div className="flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-gray-50 text-foreground/70 group-hover:text-primary group-hover:bg-primary/5 transition-colors">
                                            <FileText className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <Label htmlFor="markdown" className="text-sm font-semibold cursor-pointer group-hover:text-primary transition-colors">脑流阅读器</Label>
                                            <span className="text-[11px] text-muted-foreground mt-0.5">沉浸式阅读与内容提炼</span>
                                        </div>
                                    </div>
                                    <Switch id="markdown" checked={selectedFormat.markdown} onCheckedChange={(c) => setSelectedFormat(p => ({ ...p, markdown: c }))} className="data-[state=checked]:bg-primary" />
                                </div>

                                <div className="flex items-center justify-between group opacity-50 cursor-not-allowed">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-gray-50 text-foreground/70">
                                            <Presentation className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <Label htmlFor="marp" className="text-sm font-semibold cursor-not-allowed">幻灯片 (即将上线)</Label>
                                            <span className="text-[11px] text-muted-foreground mt-0.5">核心观点卡片展示</span>
                                        </div>
                                    </div>
                                    <Switch id="marp" checked={false} disabled className="data-[state=checked]:bg-orange-500" />
                                </div>

                                <div className="flex items-center justify-between group opacity-50 cursor-not-allowed">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-gray-50 text-foreground/70">
                                            <GitMerge className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <Label htmlFor="mermaid" className="text-sm font-semibold cursor-not-allowed">逻辑导图 (即将上线)</Label>
                                            <span className="text-[11px] text-muted-foreground mt-0.5">知识结构视觉化</span>
                                        </div>
                                    </div>
                                    <Switch id="mermaid" checked={false} disabled className="data-[state=checked]:bg-cyan-500" />
                                </div>

                                {/* Divider */}
                                <div className="h-px w-full bg-border my-2"></div>

                                <div className="flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-gray-50 text-foreground/70 group-hover:text-green-500 group-hover:bg-green-50 transition-colors">
                                            <Download className="w-5 h-5" />
                                        </div>
                                        <div className="flex flex-col">
                                            <Label htmlFor="download-video" className="text-sm font-semibold cursor-pointer group-hover:text-green-500 transition-colors">视频缓存</Label>
                                            <span className="text-[11px] text-muted-foreground mt-0.5">离线播放体验</span>
                                        </div>
                                    </div>
                                    <Switch id="download-video" checked={selectedFormat.downloadVideo} onCheckedChange={(c) => setSelectedFormat(p => ({ ...p, downloadVideo: c }))} className="data-[state=checked]:bg-green-500" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Actions */}
                <div className="p-5 border-t border-border bg-gray-50 flex items-center justify-between z-10 shrink-0">
                    <div className="flex -space-x-2">
                        {data.entries?.slice(0, 3).map((item: any, i: number) => (
                            <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-white shadow-sm flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                                P{item.index}
                            </div>
                        ))}
                        {data.entries?.length > 3 && (
                            <div className="w-8 h-8 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm">
                                +{data.entries.length - 3}
                            </div>
                        )}
                    </div>

                    <Button
                        onClick={handleStart}
                        disabled={selectedItems.length === 0}
                        className={cn(
                            "px-8 py-6 rounded-full font-medium text-[15px] transition-all duration-300 shadow-sm",
                            selectedItems.length > 0
                                ? "bg-primary hover:bg-primary/90 hover:shadow-[0_10px_20px_rgba(200,78,24,0.15)] hover:-translate-y-[1px] text-white"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        立刻开始解析 {selectedItems.length > 0 && `(${selectedItems.length})`}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
