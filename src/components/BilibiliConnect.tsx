"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle2, Loader2, QrCode, X, RefreshCw, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const STORAGE_KEY = "brainflow_bili_sessdata";
const STORAGE_TS_KEY = "brainflow_bili_sessdata_ts";
const MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000; // 25 days

type ScanStatus = "loading" | "waiting" | "scanned" | "success" | "expired" | "error";

/** Check if valid SESSDATA exists in localStorage */
export function hasValidBiliAuth(): boolean {
    if (typeof window === "undefined") return false;
    const sessdata = localStorage.getItem(STORAGE_KEY);
    const ts = localStorage.getItem(STORAGE_TS_KEY);
    if (!sessdata || !ts) return false;
    return Date.now() - parseInt(ts) < MAX_AGE_MS;
}

/** Get stored SESSDATA */
export function getBiliSessdata(): string {
    return localStorage.getItem(STORAGE_KEY) || "";
}

interface BiliQRLoginProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (sessdata: string) => void;
}

export function BiliQRLogin({ isOpen, onClose, onSuccess }: BiliQRLoginProps) {
    const [scanStatus, setScanStatus] = useState<ScanStatus>("loading");
    const [qrUrl, setQrUrl] = useState("");
    const pollTimer = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (isOpen) {
            generateQRCode();
        }
        return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
    }, [isOpen]);

    const generateQRCode = async () => {
        setScanStatus("loading");
        try {
            const res = await fetch('/tools/brainflow/api/bilibili-qrlogin', { method: 'POST' });
            const data = await res.json();
            if (data.qrUrl && data.qrcodeKey) {
                setQrUrl(data.qrUrl);
                setScanStatus("waiting");
                startPolling(data.qrcodeKey);
            } else {
                setScanStatus("error");
            }
        } catch {
            setScanStatus("error");
        }
    };

    const startPolling = useCallback((key: string) => {
        if (pollTimer.current) clearInterval(pollTimer.current);
        pollTimer.current = setInterval(async () => {
            try {
                const res = await fetch(`/tools/brainflow/api/bilibili-qrlogin?key=${key}`);
                const data = await res.json();
                if (data.status === "success" && data.sessdata) {
                    setScanStatus("success");
                    // Save to localStorage
                    localStorage.setItem(STORAGE_KEY, data.sessdata);
                    localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
                    if (pollTimer.current) clearInterval(pollTimer.current);
                    setTimeout(() => onSuccess(data.sessdata), 800);
                } else if (data.status === "scanned") {
                    setScanStatus("scanned");
                } else if (data.status === "expired") {
                    setScanStatus("expired");
                    if (pollTimer.current) clearInterval(pollTimer.current);
                }
            } catch { }
        }, 2000);
    }, [onSuccess]);

    const qrImageUrl = qrUrl; // Removing external API usage

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-card/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5">

                {/* Header */}
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-primary" />
                        用 B站 APP 扫码继续
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors p-1 rounded-lg hover:bg-slate-100">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                    需要授权以获取内容。请放心，授权仅用于本地验证，保证您的账号安全。
                </p>

                {/* QR Code */}
                <div className="flex flex-col items-center gap-4">
                    <div className="relative bg-white rounded-xl p-3 shadow-lg">
                        {(scanStatus === "waiting" || scanStatus === "scanned") && qrImageUrl ? (
                            <div className={`p-1 bg-white rounded-md ${scanStatus === "scanned" ? "opacity-40" : ""}`}>
                                <QRCodeSVG value={qrImageUrl} size={184} />
                            </div>
                        ) : scanStatus === "loading" ? (
                            <div className="w-48 h-48 flex items-center justify-center">
                                <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                            </div>
                        ) : scanStatus === "success" ? (
                            <div className="w-48 h-48 flex items-center justify-center bg-emerald-50 rounded-lg">
                                <CheckCircle2 className="w-16 h-16 text-emerald-500" />
                            </div>
                        ) : (
                            <div className="w-48 h-48 flex items-center justify-center bg-gray-50 rounded-lg">
                                <QrCode className="w-12 h-12 text-gray-300" />
                            </div>
                        )}

                        {scanStatus === "scanned" && (
                            <div className="absolute inset-3 flex items-center justify-center bg-white/80 rounded-lg">
                                <div className="text-center">
                                    <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-2" />
                                    <span className="text-xs text-amber-600 font-medium">请在手机上确认</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Status */}
                    <div className="text-sm font-medium">
                        {scanStatus === "loading" && <span className="text-slate-500">正在生成二维码...</span>}
                        {scanStatus === "waiting" && <span className="text-primary">打开 B站 APP → “我的”页面右上角扫一扫</span>}
                        {scanStatus === "scanned" && <span className="text-amber-600">已扫码，等待确认中...</span>}
                        {scanStatus === "success" && <span className="text-emerald-600">✅ 授权成功，即将继续</span>}
                        {scanStatus === "expired" && <span className="text-red-500">二维码已过期</span>}
                        {scanStatus === "error" && <span className="text-red-500">生成失败</span>}
                    </div>

                    {(scanStatus === "expired" || scanStatus === "error") && (
                        <button
                            onClick={generateQRCode}
                            className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium rounded-lg transition-all"
                        >
                            <RefreshCw className="w-4 h-4" />
                            重新生成
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
