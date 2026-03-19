import { useState, useEffect, useCallback } from 'react';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface HistoryItem {
    jobId: string;
    bvid?: string;
    title: string;
    uploader?: string;
    thumbnail?: string;
    timestamp: number;
    /** Whether this was uploaded from local multi-file instead of Bilibili */
    isLocal?: boolean;
    /** Complete analysis results (chapters, terms, transcription, etc.) */
    results?: any[];
    /** Inline Copilot conversation history */
    copilotHistory?: any[];
    /** Task type (e.g. 'live-class') */
    type?: string;
    /** For live classes, store the discussion stream */
    liveChat?: any[];
    /** For live classes, store the original transcript items */
    transcriptList?: any[];
}

interface BiliBrainDB extends DBSchema {
    history: {
        key: string; // jobId
        value: HistoryItem;
        indexes: { 'by-timestamp': number };
    };
}

const DB_NAME = 'brainflow';
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

/** Migrate legacy data to new Brainflow DB (one-time) */
async function migrateLegacyData() {
    try {
        // 1. First try to migrate from old localStorage if any
        const legacyLocal = localStorage.getItem('bilibrain_history');
        if (legacyLocal) {
            const items: HistoryItem[] = JSON.parse(legacyLocal);
            if (Array.isArray(items) && items.length > 0) {
                const db = await getDB();
                const tx = db.transaction(STORE_NAME, 'readwrite');
                for (const item of items) {
                    await tx.store.put(item);
                }
                await tx.done;
                localStorage.removeItem('bilibrain_history');
                console.log(`[IndexedDB] 已从 localStorage 迁移 ${items.length} 条记录`);
            }
        }

        // 2. Then try to migrate from the old 'bilibrain' IndexedDB Database
        try {
            const oldDb = await openDB<BiliBrainDB>('bilibrain', 1);
            if (oldDb.objectStoreNames.contains('history')) {
                const oldItems = await oldDb.getAll('history');
                if (oldItems.length > 0) {
                    const currentDb = await getDB();
                    const tx = currentDb.transaction(STORE_NAME, 'readwrite');
                    for (const item of oldItems) {
                        await tx.store.put(item);
                    }
                    await tx.done;
                    console.log(`[IndexedDB] 已从旧版 'bilibrain' DB 迁移 ${oldItems.length} 条记录至 'brainflow' DB`);
                    // Note: We don't delete the old DB just to be absolutely safe, it acts as a permanent backup.
                }
            }
            oldDb.close();
        } catch (oldDbErr) {
            // It's totally fine if the old DB doesn't exist
        }
    } catch (e) {
        console.warn('[IndexedDB] Legacy migration failed:', e);
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
            let exportFilename = `brainflow_history_${new Date().toISOString().slice(0, 10)}.json`;

            if (jobIdToExport) {
                const item = await db.get(STORE_NAME, jobIdToExport);
                if (item) {
                    dataToExport = [item];
                    exportFilename = `brainflow_history_${jobIdToExport.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.json`;
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
