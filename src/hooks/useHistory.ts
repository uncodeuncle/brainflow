import { useState, useEffect, useCallback } from 'react';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface HistoryItem {
    jobId: string;
    bvid?: string;
    title: string;
    uploader?: string;
    thumbnail?: string;
    timestamp: number;
    /** Complete analysis results (chapters, terms, transcription, etc.) */
    results?: any[];
    /** Inline Copilot conversation history */
    copilotHistory?: any[];
}

interface BiliBrainDB extends DBSchema {
    history: {
        key: string; // jobId
        value: HistoryItem;
        indexes: { 'by-timestamp': number };
    };
}

const DB_NAME = 'bilibrain';
const DB_VERSION = 1;
const STORE_NAME = 'history';

let dbInstance: IDBPDatabase<BiliBrainDB> | null = null;

async function getDB(): Promise<IDBPDatabase<BiliBrainDB>> {
    if (dbInstance) return dbInstance;
    dbInstance = await openDB<BiliBrainDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'jobId' });
                store.createIndex('by-timestamp', 'timestamp');
            }
        },
    });
    return dbInstance;
}

/** Migrate legacy localStorage data to IndexedDB (one-time) */
async function migrateLegacyData() {
    try {
        const legacy = localStorage.getItem('bilibrain_history');
        if (!legacy) return;

        const items: HistoryItem[] = JSON.parse(legacy);
        if (!Array.isArray(items) || items.length === 0) return;

        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        for (const item of items) {
            await tx.store.put(item);
        }
        await tx.done;

        // Remove legacy data after successful migration
        localStorage.removeItem('bilibrain_history');
        console.log(`[IndexedDB] 已迁移 ${items.length} 条 localStorage 历史记录`);
    } catch (e) {
        console.warn('[IndexedDB] Legacy migration failed, keeping localStorage data:', e);
    }
}

export function useHistory() {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // Load all history from IndexedDB on mount
    useEffect(() => {
        (async () => {
            try {
                await migrateLegacyData();
                const db = await getDB();
                const all = await db.getAll(STORE_NAME);
                // Sort by timestamp descending (newest first)
                all.sort((a, b) => b.timestamp - a.timestamp);
                setHistory(all);
            } catch (e) {
                console.error('Failed to load history from IndexedDB', e);
            } finally {
                setIsLoaded(true);
            }
        })();
    }, []);

    const addHistory = useCallback(async (item: Omit<HistoryItem, 'timestamp'>) => {
        const newItem: HistoryItem = { ...item, timestamp: Date.now() };
        try {
            const db = await getDB();
            await db.put(STORE_NAME, newItem);
        } catch (e) {
            console.error('Failed to save history to IndexedDB', e);
        }
        setHistory(prev => {
            const filtered = prev.filter(h => h.jobId !== item.jobId);
            return [newItem, ...filtered];
        });
    }, []);

    const removeHistory = useCallback(async (jobId: string) => {
        try {
            const db = await getDB();
            await db.delete(STORE_NAME, jobId);
        } catch (e) {
            console.error('Failed to delete history from IndexedDB', e);
        }
        setHistory(prev => prev.filter(h => h.jobId !== jobId));
    }, []);

    const updateHistoryTitle = useCallback(async (jobId: string, newTitle: string) => {
        try {
            const db = await getDB();
            const existing = await db.get(STORE_NAME, jobId);
            if (existing) {
                existing.title = newTitle;
                await db.put(STORE_NAME, existing);
            }
        } catch (e) {
            console.error('Failed to update history title in IndexedDB', e);
        }
        setHistory(prev => prev.map(h =>
            h.jobId === jobId ? { ...h, title: newTitle } : h
        ));
    }, []);

    /** Save complete analysis results to an existing history item */
    const saveResults = useCallback(async (jobId: string, results: any[]) => {
        try {
            const db = await getDB();
            const existing = await db.get(STORE_NAME, jobId);
            if (existing) {
                existing.results = results;
                await db.put(STORE_NAME, existing);
                console.log(`[IndexedDB] 已保存 ${results.length} 个分析结果到 ${jobId}`);
            }
        } catch (e) {
            console.error('Failed to save results to IndexedDB', e);
        }
        setHistory(prev => prev.map(h =>
            h.jobId === jobId ? { ...h, results } : h
        ));
    }, []);

    const updateCopilotHistory = useCallback(async (jobId: string, copilotHistory: any[]) => {
        try {
            const db = await getDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const item = await tx.store.get(jobId);
            if (item) {
                item.copilotHistory = copilotHistory;
                await tx.store.put(item);
            }
            await tx.done;
        } catch (e) {
            console.error('Failed to save Copilot history to IndexedDB', e);
        }
        setHistory(prev => prev.map(h =>
            h.jobId === jobId ? { ...h, copilotHistory } : h
        ));
    }, []);

    /** Get cached results for a specific history item */
    const getResults = useCallback(async (jobId: string): Promise<any[] | undefined> => {
        try {
            const db = await getDB();
            const item = await db.get(STORE_NAME, jobId);
            return item?.results;
        } catch (e) {
            console.error('Failed to get results from IndexedDB', e);
            return undefined;
        }
    }, []);

    const clearHistory = useCallback(async () => {
        try {
            const db = await getDB();
            await db.clear(STORE_NAME);
        } catch (e) {
            console.error('Failed to clear IndexedDB history', e);
        }
        setHistory([]);
    }, []);

    const exportHistory = useCallback(async (jobIdToExport?: string) => {
        try {
            const db = await getDB();
            let dataToExport: HistoryItem[] = [];
            let exportFilename = `bilibrain_history_${new Date().toISOString().slice(0, 10)}.json`;

            if (jobIdToExport) {
                const item = await db.get(STORE_NAME, jobIdToExport);
                if (item) {
                    dataToExport = [item];
                    exportFilename = `bilibrain_history_${jobIdToExport.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.json`;
                } else {
                    alert('未找到该笔记记录');
                    return;
                }
            } else {
                dataToExport = await db.getAll(STORE_NAME);
                dataToExport.sort((a, b) => b.timestamp - a.timestamp);
            }

            const dataStr = JSON.stringify(dataToExport, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const linkElement = document.createElement('a');
            linkElement.href = url;
            linkElement.download = exportFilename;
            linkElement.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to export history', e);
            alert('导出失败');
        }
    }, []);

    const importHistory = useCallback(async (file: File) => {
        return new Promise<void>((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const content = e.target?.result as string;
                    const importedData = JSON.parse(content) as HistoryItem[];

                    if (!Array.isArray(importedData)) {
                        throw new Error('Invalid format');
                    }

                    const db = await getDB();
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    for (const item of importedData) {
                        if (item.jobId) {
                            await tx.store.put(item);
                        }
                    }
                    await tx.done;

                    // Reload all from DB to sync state
                    const all = await db.getAll(STORE_NAME);
                    all.sort((a, b) => b.timestamp - a.timestamp);
                    setHistory(all);

                    alert(`成功导入 ${importedData.length} 条记录（含完整分析数据）`);
                } catch (err) {
                    console.error('Failed to parse history file', err);
                    alert('导入失败：文件格式不正确');
                }
                resolve();
            };
            reader.readAsText(file);
        });
    }, []);

    return {
        history,
        isLoaded,
        addHistory,
        removeHistory,
        updateHistoryTitle,
        saveResults,
        getResults,
        clearHistory,
        exportHistory,
        importHistory,
        updateCopilotHistory
    };
}
