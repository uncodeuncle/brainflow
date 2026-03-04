import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import OSS from 'ali-oss';
import { Upload, X, File, FileText, Image as ImageIcon, FileAudio, FileVideo, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from "@/components/ui/progress";
import { getBasePath } from "@/lib/utils";

// Allowed extensions for processing
export const ALLOWED_EXTENSIONS = [
    // Video
    '.mp4', '.mkv', '.mov', '.avi', '.flv', '.wmv', '.webm', '.m4v',
    // Audio
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma',
    // Documents
    '.pdf', '.txt', '.doc', '.docx', '.md', '.csv',
    // Subtitles
    '.srt', '.vtt'
];

interface UploadFile {
    file: File;
    id: string;
    progress: number;
    status: 'pending' | 'uploading' | 'success' | 'error';
    ossUrl?: string; // e.g. oss://bucket/brainflow-raw/...
    errorMsg?: string;
}

interface LocalUploaderProps {
    onUploadComplete: (files: { name: string, url: string, size: number }[]) => void;
    onCancel: () => void;
}

export function LocalUploader({ onUploadComplete, onCancel }: LocalUploaderProps) {
    const [files, setFiles] = useState<UploadFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [globalError, setGlobalError] = useState('');

    const getFileIcon = (file: File) => {
        if (file.type.startsWith('video/')) return <FileVideo className="w-5 h-5 text-blue-500" />;
        if (file.type.startsWith('audio/')) return <FileAudio className="w-5 h-5 text-purple-500" />;
        if (file.name.endsWith('.pdf')) return <FileText className="w-5 h-5 text-red-500" />;
        if (file.type.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-green-500" />;
        return <FileText className="w-5 h-5 text-slate-500" />;
    };

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setGlobalError('');
        const newFiles = acceptedFiles.map(f => ({
            file: f,
            id: Math.random().toString(36).substring(7),
            progress: 0,
            status: 'pending' as const
        }));
        setFiles(prev => [...prev, ...newFiles]);
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        // Note: Accept prop can be very specific, but we'll manually validate to avoid dropping unsupported files silently
    });

    const removeFile = (id: string) => {
        if (isUploading) return;
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    const startUpload = async () => {
        if (files.length === 0) return;

        // Validation
        const invalidFiles = files.filter(f => !ALLOWED_EXTENSIONS.some(ext => f.file.name.toLowerCase().endsWith(ext)));
        if (invalidFiles.length > 0) {
            setGlobalError(`包含不支持的文件格式: ${invalidFiles.map(f => f.file.name).join(', ')}`);
            return;
        }

        setIsUploading(true);
        setGlobalError('');

        try {
            // 1. Get STS Token
            const tokenRes = await fetch(`${getBasePath()}/api/oss-sts`);
            if (!tokenRes.ok) {
                throw new Error('无法获取阿里云直传授权，请检查服务端配置');
            }
            const tokenData = await tokenRes.json();

            if (tokenData.error) throw new Error(tokenData.error);

            // 2. Init OSS Client
            const client = new OSS({
                region: tokenData.region,
                accessKeyId: tokenData.AccessKeyId,
                accessKeySecret: tokenData.AccessKeySecret,
                stsToken: tokenData.SecurityToken,
                bucket: tokenData.bucket,
                secure: true, // force HTTPS
            });

            const uploadPromises = files.map(async (fItem) => {
                if (fItem.status === 'success') return fItem; // Skip already uploaded

                setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, status: 'uploading' } : p));

                try {
                    // Construct unique object path: brainflow-raw/timestamp-random/filename
                    const objectName = `brainflow-raw/${Date.now()}-${Math.random().toString(36).substring(7)}/${fItem.file.name}`;

                    await client.multipartUpload(objectName, fItem.file, {
                        progress: (p, cpt, res) => {
                            setFiles(prev => prev.map(item => item.id === fItem.id ? { ...item, progress: Math.floor(p * 100) } : item));
                        },
                        // parallel: 3,
                        // partSize: 1024 * 1024 * 5, // 5MB chunks
                    });

                    // Set complete
                    setFiles(prev => prev.map(p => p.id === fItem.id ? {
                        ...p,
                        status: 'success',
                        progress: 100,
                        ossUrl: `oss://${tokenData.bucket}/${objectName}`
                    } : p));

                } catch (err: any) {
                    console.error(`Upload failed for ${fItem.file.name}:`, err);
                    setFiles(prev => prev.map(p => p.id === fItem.id ? { ...p, status: 'error', errorMsg: err.message } : p));
                }
            });

            await Promise.all(uploadPromises);

            // Check if all successful
            setFiles(currentFiles => {
                const allSuccess = currentFiles.every(f => f.status === 'success');
                if (allSuccess) {
                    // Trigger completion
                    const results = currentFiles.map(f => ({
                        name: f.file.name,
                        url: f.ossUrl!,
                        size: f.file.size
                    }));
                    setTimeout(() => onUploadComplete(results), 500); // slight delay to show 100% green
                } else {
                    setGlobalError('部分文件上传失败，请移除失败文件后重试');
                }
                return currentFiles;
            });

        } catch (err: any) {
            console.error('OSS Client Upload Error Details:', err);
            setGlobalError(err.message || err.toString() || '上传系统出现异常');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="w-full bg-white rounded-[20px] border border-border overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.05)]">
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b border-border bg-slate-50/50">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <Upload className="w-4 h-4 text-primary" />
                    上传本地文件
                </h3>
                {!isUploading && (
                    <Button variant="ghost" size="icon" onClick={onCancel} className="h-6 w-6 rounded-full hover:bg-slate-200 text-slate-500">
                        <X className="w-4 h-4" />
                    </Button>
                )}
            </div>

            <div className="p-4 md:p-6 space-y-4">
                {/* Dropzone */}
                {!isUploading && files.length === 0 && (
                    <div
                        {...getRootProps()}
                        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors
              ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-slate-50'}
            `}
                    >
                        <input {...getInputProps()} />
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                            <Upload className="w-6 h-6 text-primary" />
                        </div>
                        <p className="font-semibold text-slate-700 mb-1">点击选择 或 拖拽文件到这里</p>
                        <p className="text-xs text-muted-foreground max-w-sm text-center">
                            支持音视频 (.mp4, .mp3, .m4a等) 与文档 (.pdf, .txt, .docx等)。可批量拖入文件夹或多个文件。
                        </p>
                    </div>
                )}

                {/* File List */}
                {files.length > 0 && (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                        {files.map((fItem) => (
                            <div key={fItem.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-white shadow-sm">
                                <div className="shrink-0 p-2 bg-slate-50 rounded-lg">
                                    {getFileIcon(fItem.file)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-1.5">
                                        <span className="text-sm font-semibold truncate max-w-[200px] md:max-w-xs">{fItem.file.name}</span>
                                        <span className="text-xs text-muted-foreground">{(fItem.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                    </div>

                                    {fItem.status !== 'pending' && (
                                        <div className="flex items-center gap-2">
                                            <Progress
                                                value={fItem.progress}
                                                className="h-1.5"
                                                indicatorClassName={fItem.status === 'error' ? 'bg-red-500' : fItem.status === 'success' ? 'bg-green-500' : 'bg-primary'}
                                            />
                                            <span className="text-[10px] w-8 font-mono text-right">{Math.round(fItem.progress)}%</span>
                                        </div>
                                    )}

                                    {fItem.status === 'error' && (
                                        <p className="text-[10px] text-red-500 mt-1 line-clamp-1">{fItem.errorMsg}</p>
                                    )}
                                </div>

                                {!isUploading && fItem.status !== 'success' && (
                                    <Button variant="ghost" size="icon" onClick={() => removeFile(fItem.id)} className="shrink-0 h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full">
                                        <X className="w-4 h-4" />
                                    </Button>
                                )}

                                {fItem.status === 'success' && (
                                    <div className="shrink-0 flex items-center justify-center h-8 w-8 text-green-500">
                                        <CheckCircle2 className="w-5 h-5" />
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Add more button if not uploading */}
                        {!isUploading && files.length > 0 && (
                            <div {...getRootProps()} className="border-2 border-dashed border-border rounded-lg p-3 text-center cursor-pointer hover:bg-slate-50 hover:border-slate-300 transition-colors">
                                <input {...getInputProps()} />
                                <span className="text-sm font-medium text-slate-500">+ 继续添加文件</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Global Error */}
                {globalError && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-600">{globalError}</p>
                    </div>
                )}

                {/* Actions */}
                {files.length > 0 && (
                    <div className="pt-2 border-t border-border mt-4 flex justify-between items-center">
                        <div className="text-xs text-muted-foreground hidden md:block">
                            共 {files.length} 个文件，总大小 {(files.reduce((acc, f) => acc + f.file.size, 0) / (1024 * 1024)).toFixed(1)} MB
                        </div>

                        <div className="flex gap-2 w-full md:w-auto">
                            {!isUploading && (
                                <Button variant="outline" onClick={onCancel} className="flex-1 md:flex-none">取消</Button>
                            )}

                            <Button
                                onClick={startUpload}
                                disabled={isUploading || files.every(f => f.status === 'success')}
                                className="flex-1 md:flex-none bg-primary hover:bg-primary/90 text-white min-w-[120px]"
                            >
                                {isUploading ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> 上传中...</>
                                ) : files.every(f => f.status === 'success') ? (
                                    <><CheckCircle2 className="w-4 h-4 mr-2" /> 准备就绪</>
                                ) : (
                                    `开始上传 (${files.length})`
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
