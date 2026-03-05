import { useState } from "react";
import { Trash2, Download, MonitorPlay, Edit2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface HistoryCardProps {
    item: any;
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

export function HistoryCard({
    item,
    editingId,
    editingTitle,
    setEditingTitle,
    onStartEdit,
    onSaveEdit,
    onCancelEdit,
    onClickCard,
    onExport,
    onDelete
}: HistoryCardProps) {
    return (
        <div className="group relative flex items-center gap-4 p-3.5 rounded-[20px] border border-slate-200/60 bg-white hover:-translate-y-[2px] hover:border-primary/20 hover:shadow-xl transition-all duration-300 ease-out cursor-pointer">
            <div className="relative w-[5.5rem] h-16 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]" onClick={() => onClickCard(item.jobId)}>
                {item.thumbnail ? (
                    <img src={item.thumbnail} alt="cover" className="object-cover w-full h-full transform group-hover:scale-105 transition-transform duration-500 ease-out" />
                ) : (
                    <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-slate-100 to-slate-200">
                        <MonitorPlay className="w-5 h-5 text-slate-400 opacity-50" />
                    </div>
                )}
                <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors duration-300"></div>
            </div>

            <div className="flex-1 min-w-0 py-0.5" onClick={() => { if (editingId !== item.jobId) onClickCard(item.jobId); }}>
                {editingId === item.jobId ? (
                    <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                        <Input
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            className="h-7 text-xs px-2 py-0 focus-visible:ring-1 focus-visible:ring-primary bg-slate-50 border-input flex-1"
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === 'Enter') onSaveEdit(e as any, item.jobId);
                                if (e.key === 'Escape') onCancelEdit(e as any);
                            }}
                        />
                        <Button variant="ghost" size="icon" onClick={(e) => onSaveEdit(e, item.jobId)} className="w-6 h-6 hover:bg-green-100 text-green-600 rounded">
                            <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={onCancelEdit} className="w-6 h-6 hover:bg-slate-200 text-slate-500 rounded">
                            <X className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-start justify-between gap-2 group/title">
                        <h3 className="text-[13px] font-bold text-slate-800 line-clamp-2 group-hover:text-primary transition-colors duration-300 leading-snug pr-2">
                            {item.title || `未命名笔记 (ID: ${item.jobId.slice(0, 6)})`}
                        </h3>
                        <button
                            onClick={(e) => onStartEdit(e, item.jobId, item.title)}
                            className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-primary/10 rounded text-muted-foreground hover:text-primary transition-all shrink-0 mt-0.5"
                            title="重命名"
                        >
                            <Edit2 className="w-3 h-3" />
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500 font-medium">
                    <span className="flex items-center bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 truncate max-w-[120px] shrink-0">
                        👤 {item.uploader || '未知来源'}
                    </span>
                    <span className="text-slate-300 shrink-0">•</span>
                    <span className="flex items-center tracking-tight shrink-0 whitespace-nowrap">
                        🕒 {new Date(item.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>

            <div className="flex flex-col gap-1 items-end self-start">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onExport(item.jobId); }} className="w-7 h-7 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 text-slate-300 hover:text-blue-500 shrink-0" title="导出此笔记">
                    <Download className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(item.jobId); }} className="w-7 h-7 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 text-slate-300 hover:text-red-500 shrink-0" title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    );
}
