"use client";

import { useState, useRef } from "react";
import { Search, Loader2, History, Trash2, Download, Upload, AlertTriangle, MonitorPlay, Edit2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AnalyzeModal } from "@/components/AnalyzeModal";
import { Reader } from "@/components/Reader";
import { BiliQRLogin, hasValidBiliAuth, getBiliSessdata } from "@/components/BilibiliConnect";
import { useHistory } from "@/hooks/useHistory";
import { getBasePath } from "@/lib/utils";

import { LocalUploader } from "@/components/LocalUploader";

function isBilibiliUrl(url: string): boolean {
  return url.includes('bilibili.com') || url.includes('b23.tv');
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeData, setAnalyzeData] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [showQRLogin, setShowQRLogin] = useState(false);

  // Toggles the Local Uploader UI
  const [showLocalUploader, setShowLocalUploader] = useState(false);

  const { history, isLoaded, addHistory, removeHistory, updateHistoryTitle, saveResults, exportHistory, importHistory, clearHistory, updateCopilotHistory } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const handleStartEdit = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle || "");
  };

  const handleSaveEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (editingTitle.trim()) {
      updateHistoryTitle(id, editingTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    if (isBilibiliUrl(url)) {
      setShowQRLogin(true);
      return;
    }

    doAnalyze();
  };

  const doAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(`${getBasePath()}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, sessdata: getBiliSessdata() }),
      });

      const data = await res.json();
      if (res.ok) {
        setAnalyzeData(data);
        setIsModalOpen(true);
      } else {
        alert("解析失败: " + (data.error || "未知错误"));
      }
    } catch (err) {
      alert("网络请求失败，请确保后台正常运行");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleQRSuccess = (sessdata: string) => {
    setShowQRLogin(false);
    doAnalyze();
  };

  // Called when LocalUploader finishes pushing to OSS
  const handleLocalUploadComplete = (uploadedFiles: { name: string, url: string, size: number }[]) => {
    // Generate a pseudo-analyzeData to reuse the task confirmation modal
    const fauxAnalyzeData = {
      title: uploadedFiles.length > 1 ? `本地合集：${uploadedFiles[0].name.replace(/\.[^/.]+$/, "")} 等${uploadedFiles.length}个文件` : uploadedFiles[0].name.replace(/\.[^/.]+$/, ""),
      uploader: 'Local File',
      thumbnail: '', // We will show a default SVG in Reader
      isLocal: true,
      entries: uploadedFiles.map((f, i) => ({
        index: i + 1,
        page: i + 1,
        title: f.name.replace(/\.[^/.]+$/, ""),
        duration: 0,
        dimension: { width: 1920, height: 1080 },
        // Attach the OSS URL directly to the entry so the API/Worker knows where to pull it from
        localOssUrl: f.url
      }))
    };

    setAnalyzeData(fauxAnalyzeData);
    setShowLocalUploader(false);
    setIsModalOpen(true); // Open the AnalyzeModal for final confirmation
  };

  const handleStartTask = async (config: any) => {
    setIsModalOpen(false);
    try {
      // Pass sessdata from localStorage if available
      const sessdata = getBiliSessdata();
      const payload = { ...config, url, ...(sessdata ? { sessdata } : {}) };

      // If it's a local task, we inject the local struct
      if (analyzeData?.isLocal) {
        payload.type = 'local';
        payload.url = 'local_multi_upload';
        payload.rawData = analyzeData; // this contains the entries with localOssUrl
      }

      const res = await fetch(`${getBasePath()}/api/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        // Append timestamp to BullMQ's sequential jobId to guarantee global uniqueness
        const uniqueJobId = `${data.jobId}_${Date.now()}`;
        addHistory({
          jobId: uniqueJobId,
          title: analyzeData.isLocal ? analyzeData.title : (config.rawData?.title || analyzeData?.title || config.rawData?.entries?.[0]?.title || analyzeData?.entries?.[0]?.title || '未命名合集任务'),
          uploader: analyzeData.isLocal ? 'Local File' : (config.rawData?.uploader || analyzeData?.uploader || config.rawData?.entries?.[0]?.uploader || analyzeData?.entries?.[0]?.uploader),
          thumbnail: analyzeData.isLocal ? '' : (config.rawData?.thumbnail || analyzeData?.thumbnail || config.rawData?.entries?.[0]?.thumbnail || analyzeData?.entries?.[0]?.thumbnail),
          isLocal: analyzeData.isLocal
        });
        setActiveJobId(uniqueJobId);
      } else {
        alert("任务提交失败!");
      }
    } catch (err) {
      alert("无法提交任务。确保后台 Redis 正在运行");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importHistory(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset
    }
  };

  if (activeJobId) {
    const historicalItem = history.find(h => h.jobId === activeJobId);
    return <Reader jobId={activeJobId} onBack={() => setActiveJobId(null)} saveResults={saveResults} initialResults={historicalItem?.results} initialCopilotHistory={historicalItem?.copilotHistory} updateCopilotHistory={updateCopilotHistory} isLocal={historicalItem?.isLocal} />;
  }

  const hasHistory = isLoaded && history.length > 0;

  return (
    <main className={`flex min-h-screen flex-col items-center p-6 ${hasHistory ? 'justify-start pt-24 md:pt-42' : 'justify-center'} pb-12 relative overflow-y-auto bg-background transition-all duration-700 ease-in-out`}>

      {/* Fixed Top-Left Import/Export Buttons */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileUpload} />
        <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="h-8 shadow-sm rounded-full border-border hover:border-primary hover:text-primary transition-colors text-xs text-muted-foreground bg-white/80 backdrop-blur-sm">
          <Upload className="w-3.5 h-3.5 mr-1.5" /> 导入笔记
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportHistory()} className="h-8 shadow-sm rounded-full border-border hover:border-primary hover:text-primary transition-colors text-xs text-muted-foreground bg-white/80 backdrop-blur-sm">
          <Download className="w-3.5 h-3.5 mr-1.5" /> 导出全部
        </Button>
      </div>

      <div className={`z-10 w-full max-w-3xl flex flex-col items-center space-y-10 shrink-0 transition-transform duration-700 ${!isLoaded ? 'opacity-0' : 'opacity-100'} animate-in fade-in zoom-in-95`}>
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center items-center gap-2 mb-4">
            <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase">POWERED BY</span>
            <img src={`${getBasePath()}/Unlogomini.png`} alt="Logo" className="h-[18px] object-contain opacity-70 hover:opacity-100 transition-opacity" />
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-foreground drop-shadow-sm">
            BrainFlow / 脑流
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-normal leading-relaxed">
            把视频、本地音视频与冗长文档即刻脱水，将知识点榨成脑流。
          </p>
        </div>

        {/* Input Switcher Block */}
        <div className="w-full relative group transition-shadow duration-300">

          {showLocalUploader ? (
            <div className="animate-in fade-in slide-in-from-top-4 duration-300">
              <LocalUploader
                onCancel={() => setShowLocalUploader(false)}
                onUploadComplete={handleLocalUploadComplete}
              />
            </div>
          ) : (
            <>
              <form
                onSubmit={handleAnalyze}
                className="relative flex items-center rounded-[20px] p-2 bg-white border border-border shadow-[0_10px_30px_rgba(0,0,0,0.05)] hover:shadow-[0_15px_40px_rgba(200,78,24,0.15)] transition-shadow duration-300"
              >
                <div className="pl-4 pr-2 text-muted-foreground group-focus-within:text-primary transition-colors">
                  <Search className="w-6 h-6" />
                </div>
                <Input
                  type="text"
                  placeholder="粘贴视频链接至此..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 bg-transparent border-0 h-14 text-lg focus-visible:ring-0 focus-visible:ring-offset-0 px-2 placeholder:text-muted-foreground/50 transition-all font-normal text-foreground"
                  disabled={isAnalyzing}
                />

                <div
                  className="mr-3 ml-2 flex cursor-pointer text-muted-foreground hover:text-primary transition-colors border-l border-border pl-4"
                  title="上传本地文件 (视频/音频/PDF等)"
                  onClick={() => setShowLocalUploader(true)}
                >
                  <Upload className="w-5 h-5" />
                </div>

                <Button
                  type="submit"
                  disabled={!url || isAnalyzing}
                  className="h-12 px-8 mr-1 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-base transition-all shadow-sm hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      解析中...
                    </>
                  ) : (
                    "开始解析"
                  )}
                </Button>
              </form>


            </>
          )}
        </div>
      </div>

      {/* Local History Section */}
      {hasHistory && (
        <div className="z-10 w-full max-w-3xl mt-16 md:mt-20 animate-in fade-in slide-in-from-bottom-8 duration-700 flex flex-col shrink-0">
          <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
            <h2 className="text-lg font-bold flex items-center text-slate-800">
              <History className="w-4 h-4 mr-2 text-primary" />
              过往笔记
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => { if (confirm('确定要清空所有本地记录吗？')) clearHistory() }} className="h-8 rounded-full hover:bg-slate-100 text-slate-500 text-xs">
                清空记录
              </Button>
            </div>
          </div>

          {history.length > 50 && (
            <div className="mb-6 p-4 rounded-xl bg-orange-50 border border-orange-100 text-orange-800 text-sm flex items-start shadow-sm">
              <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-orange-500" />
              <span>您的本地记录较多（已超 50 条），建议及时 <button onClick={() => exportHistory()} className="underline font-semibold hover:text-orange-600 transition-colors">导出备份</button>，或清理不需要的记录。</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {history.map((item) => (
              <div key={item.jobId} className="group relative flex items-center gap-3 p-3 rounded-2xl border border-border bg-white hover:border-primary/50 shadow-sm hover:shadow-md transition-all cursor-pointer">
                <div className="relative w-20 h-14 rounded-lg overflow-hidden bg-slate-50 shrink-0 border border-border/50" onClick={() => setActiveJobId(item.jobId)}>
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="cover" className="object-cover w-full h-full transform group-hover:scale-105 transition duration-500" />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-slate-100 to-slate-200">
                      <MonitorPlay className="w-6 h-6 text-slate-400 opacity-60" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/5 group-hover:bg-transparent transition-colors"></div>
                </div>

                <div className="flex-1 min-w-0 py-0.5" onClick={() => { if (editingId !== item.jobId) setActiveJobId(item.jobId); }}>
                  {editingId === item.jobId ? (
                    <div className="flex items-center gap-1 w-full" onClick={e => e.stopPropagation()}>
                      <Input
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        className="h-7 text-xs px-2 py-0 focus-visible:ring-1 focus-visible:ring-primary bg-slate-50 border-input flex-1"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit(e as any, item.jobId);
                          if (e.key === 'Escape') handleCancelEdit(e as any);
                        }}
                      />
                      <Button variant="ghost" size="icon" onClick={(e) => handleSaveEdit(e, item.jobId)} className="w-6 h-6 hover:bg-green-100 text-green-600 rounded">
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={handleCancelEdit} className="w-6 h-6 hover:bg-slate-200 text-slate-500 rounded">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2 group/title">
                      <h3 className="text-[13px] font-bold text-slate-800 line-clamp-2 group-hover:text-primary transition-colors leading-snug">
                        {item.title || `未命名笔记 (ID: ${item.jobId.slice(0, 6)})`}
                      </h3>
                      <button
                        onClick={(e) => handleStartEdit(e, item.jobId, item.title)}
                        className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-primary/10 rounded text-muted-foreground hover:text-primary transition-all shrink-0 mt-0.5"
                        title="重命名"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500 font-medium">
                    <span className="flex items-center bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 truncate max-w-[120px]">
                      👤 {item.uploader || '未知来源'}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="flex items-center">
                      🕒 {new Date(item.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 items-end self-start">
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); exportHistory(item.jobId); }} className="w-7 h-7 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 text-slate-300 hover:text-blue-500 shrink-0" title="导出此笔记">
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); removeHistory(item.jobId); }} className="w-7 h-7 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 text-slate-300 hover:text-red-500 shrink-0" title="删除">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnalyzeModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        data={analyzeData}
        onConfirm={handleStartTask}
      />

      {/* Invisible QR Login Modal - only appears when needed */}
      <BiliQRLogin
        isOpen={showQRLogin}
        onClose={() => setShowQRLogin(false)}
        onSuccess={handleQRSuccess}
      />
    </main>
  );
}
