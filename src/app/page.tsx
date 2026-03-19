"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2, History, Trash2, Download, Upload, AlertTriangle, MonitorPlay, Edit2, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AnalyzeModal } from "@/components/AnalyzeModal";
import { Reader } from "@/components/Reader";
import { BiliQRLogin, hasValidBiliAuth, getBiliSessdata } from "@/components/BilibiliConnect";
import { useHistory } from "@/hooks/useHistory";
import { getBasePath } from "@/lib/utils";

import { LocalUploader } from "@/components/LocalUploader";
import { BroadcastMarquee } from "@/components/BroadcastMarquee";
import { HistoryCard } from "@/components/HistoryCard";
import { HistoryArchiveModal } from "@/components/HistoryArchiveModal";

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
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);

  const { history, isLoaded, addHistory, removeHistory, updateHistoryTitle, saveResults, exportHistory, importHistory, clearHistory, updateCopilotHistory } = useHistory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    if (isLoaded && typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const jobId = searchParams.get('jobId');
      if (jobId && !activeJobId) {
        // Automatically open reader if the history item exists
        const itemExists = history.some(h => h.jobId === jobId);
        if (itemExists) setActiveJobId(jobId);
      }
    }
  }, [isLoaded, history, activeJobId]);

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
        if (data.url) setUrl(data.url); // Sync the input box with the clean URL
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
        const uniqueJobId = data.jobId; // Use original ID from API for proper polling
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
    const isLiveClass = (historicalItem as any)?.type === 'live-class';
    
    return (
      <div className="relative w-full h-full">
        <Reader 
          jobId={activeJobId} 
          onBack={() => {
             setActiveJobId(null);
             window.history.replaceState({}, '', window.location.pathname);
          }} 
          saveResults={saveResults} 
          initialResults={historicalItem?.results} 
          initialCopilotHistory={historicalItem?.copilotHistory} 
          updateCopilotHistory={updateCopilotHistory} 
          isLocal={historicalItem?.isLocal}
          isLiveClass={isLiveClass} 
        />
      </div>
    );
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
        <Button variant="outline" size="sm" onClick={() => window.location.href = `${getBasePath()}/live-class`} className="h-8 shadow-sm rounded-full border-border hover:border-primary hover:text-primary transition-colors text-xs text-muted-foreground bg-white/80 backdrop-blur-sm">
          <MonitorPlay className="w-3.5 h-3.5 mr-1.5" /> 网课实时助手
        </Button>
      </div>

      {/* Fixed Top-Right Broadcast Marquee */}
      <div className="fixed top-4 right-4 z-50 max-w-sm flex justify-end">
        <BroadcastMarquee />
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
            把合集视频/音视与冗长文档即刻脱水，将知识点榨成脑流。
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
              <Button variant="ghost" size="sm" onClick={() => setIsArchiveModalOpen(true)} className="h-8 rounded-full bg-primary/5 hover:bg-primary/10 text-primary font-medium text-xs">
                更多记录 ({history.length})
              </Button>
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
            {history.slice(0, 6).map((item) => (
              <HistoryCard
                key={item.jobId}
                item={item}
                editingId={editingId}
                editingTitle={editingTitle}
                setEditingTitle={setEditingTitle}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onClickCard={setActiveJobId}
                onExport={exportHistory}
                onDelete={removeHistory}
              />
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

      <BiliQRLogin
        isOpen={showQRLogin}
        onClose={() => setShowQRLogin(false)}
        onSuccess={handleQRSuccess}
      />

      <HistoryArchiveModal
        isOpen={isArchiveModalOpen}
        onOpenChange={setIsArchiveModalOpen}
        history={history}
        editingId={editingId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        onStartEdit={handleStartEdit}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onClickCard={setActiveJobId}
        onExport={exportHistory}
        onDelete={removeHistory}
      />
    </main>
  );
}
