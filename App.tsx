
import React, { useState, useMemo, useEffect } from 'react';
import { AnalysisResult, RawCSVRow, VideoEarning, LabelSummary } from './types';
import { getAIInsights } from './services/geminiService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import * as XLSX from 'xlsx';

// Global PapaParse availability from script tag
declare const Papa: any;

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([]);
  const [hashtagSearchQuery, setHashtagSearchQuery] = useState("");
  const [showFilter, setShowFilter] = useState(true);
  const [showHashtagFilter, setShowHashtagFilter] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hideLowEarnings, setHideLowEarnings] = useState<boolean>(false);
  const [hideLowEarningLabels, setHideLowEarningLabels] = useState<boolean>(false);
  const [exchangeRate, setExchangeRate] = useState<number>(25400); // Default exchange rate
  const [bonusPercentage, setBonusPercentage] = useState<number>(5); // Default bonus %
  const [loading, setLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('earning_analyst_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('earning_analyst_history', JSON.stringify(history));
  }, [history]);

  const formatVND = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  };

  const extractHashtags = (text: string): string[] => {
    if (!text) return [];
    const matches = text.match(/#[\p{L}\p{N}_]+/gu);
    return matches ? Array.from(new Set(matches.map(tag => tag.toLowerCase()))) : [];
  };

  const parseEarning = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      return parseFloat(val.replace(/,/g, '')) || 0;
    }
    return 0;
  };

  // Helper functions for filtering
  const selectAllLabels = () => {
    if (data) {
      setSelectedLabels(data.labelSummaries.map(l => l.label));
    }
  };

  const deselectAllLabels = () => {
    setSelectedLabels([]);
  };

  const toggleLabel = (label: string) => {
    setSelectedLabels(prev => 
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const toggleHashtag = (tag: string) => {
    setSelectedHashtags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const processCSV = (results: any, currentFileName: string) => {
    const headers = results.meta.fields || [];
    const rows: RawCSVRow[] = results.data;
    const videoMap = new Map<string, VideoEarning>();
    const labelMap = new Map<string, { total: number; count: Set<string> }>();
    const hashtagSet = new Set<string>();
    const dates: Date[] = [];

    const missing: string[] = [];
    const hasPostId = headers.some((h: string) => ["Post ID", "Video asset ID", "ID tài sản video"].includes(h));
    const hasDescription = headers.some((h: string) => ["Description", "Mô tả"].includes(h));

    if (!hasPostId) missing.push("Post ID / ID tài sản video");
    if (!hasDescription) missing.push("Description / Mô tả");
    
    setMissingColumns(missing);

    rows.forEach((row) => {
      const title = (row["Tiêu đề"] || row["Title"])?.trim();
      const label = (row["Nhãn tùy chỉnh"] || row["Custom labels"])?.trim() || "Không có nhãn";
      const assetId = (row["Post ID"] || row["Video asset ID"] || row["ID tài sản video"])?.toString().trim();
      const dateStr = (row["Ngày"] || row["Date"])?.trim();
      const description = row["Description"] || row["Mô tả"] || "";
      const rowHashtags = extractHashtags(description);
      
      const earningVN = parseEarning(row["Thu nhập ước tính khi tham gia chương trình kiếm tiền từ nội dung"]);
      const earningEN = parseEarning(row["Approximate content monetization earnings"]);
      const earning = earningVN + earningEN;
      
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          dates.push(parsedDate);
        }
      }

      if (!title) return;

      const key = `${title}-${label}`;
      if (videoMap.has(key)) {
        const existing = videoMap.get(key)!;
        existing.totalEarning += earning;
        if (!existing.assetId && assetId) {
          existing.assetId = assetId;
        }
        rowHashtags.forEach(tag => {
          if (!existing.hashtags.includes(tag)) {
            existing.hashtags.push(tag);
          }
        });
      } else {
        videoMap.set(key, { 
          title, 
          label, 
          totalEarning: earning, 
          assetId, 
          date: dateStr, 
          hashtags: rowHashtags 
        });
      }

      rowHashtags.forEach(tag => hashtagSet.add(tag));

      if (!labelMap.has(label)) {
        labelMap.set(label, { total: 0, count: new Set() });
      }
      const lblData = labelMap.get(label)!;
      lblData.total += earning;
      lblData.count.add(title);
    });

    const videoEarnings = Array.from(videoMap.values()).sort((a, b) => b.totalEarning - a.totalEarning);
    const lowEarningCount = videoEarnings.filter(v => v.totalEarning < 1).length;

    const labelSummaries: LabelSummary[] = Array.from(labelMap.entries()).map(([label, info]) => ({
      label,
      totalEarning: info.total,
      videoCount: info.count.size
    })).sort((a, b) => b.totalEarning - a.totalEarning);

    const grandTotal = labelSummaries.reduce((acc, curr) => acc + curr.totalEarning, 0);

    let startDate, endDate;
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
      const formatDate = (d: Date) => d.toLocaleDateString('vi-VN');
      startDate = formatDate(minDate);
      endDate = formatDate(maxDate);
    }

    const newResult: AnalysisResult = { 
      id: crypto.randomUUID(),
      fileName: currentFileName,
      timestamp: Date.now(),
      videoEarnings, 
      labelSummaries, 
      grandTotal,
      lowEarningCount,
      startDate,
      endDate,
      allHashtags: Array.from(hashtagSet).sort(),
      aiInsight: null,
      missingColumns: missing
    };
    
    setData(newResult);
    setHistory(prev => [newResult, ...prev.slice(0, 9)]); // Keep last 10
    setSelectedLabels(labelSummaries.map(l => l.label));
    setSelectedHashtags([]);
    setLoading(false);
    
    handleAIAnalysis(newResult, bonusPercentage);
  };

  const filteredData = useMemo(() => {
    if (!data) return null;
    
    let workingLabels = data.labelSummaries.filter(l => selectedLabels.includes(l.label));
    if (hideLowEarningLabels) {
      workingLabels = workingLabels.filter(l => l.totalEarning >= 1);
    }

    const labelNamesToInclude = workingLabels.map(l => l.label);
    let filteredVideos = data.videoEarnings.filter(v => labelNamesToInclude.includes(v.label));
    
    if (selectedHashtags.length > 0) {
      filteredVideos = filteredVideos.filter(v => 
        selectedHashtags.some(tag => v.hashtags.includes(tag))
      );
    }

    if (hideLowEarnings) {
      filteredVideos = filteredVideos.filter(v => v.totalEarning >= 1);
    }

    const finalLabels = workingLabels.map(l => {
      const videosForThisLabel = filteredVideos.filter(v => v.label === l.label);
      return {
        ...l,
        totalEarning: videosForThisLabel.reduce((acc, v) => acc + v.totalEarning, 0),
        videoCount: videosForThisLabel.length
      };
    })
    .filter(l => l.videoCount > 0)
    .sort((a, b) => b.totalEarning - a.totalEarning);

    const filteredTotal = finalLabels.reduce((acc, curr) => acc + curr.totalEarning, 0);
    const filteredLowCount = filteredVideos.filter(v => v.totalEarning < 1).length;

    return {
      ...data,
      labelSummaries: finalLabels,
      videoEarnings: filteredVideos,
      grandTotal: filteredTotal,
      lowEarningCount: filteredLowCount
    };
  }, [data, selectedLabels, selectedHashtags, hideLowEarnings, hideLowEarningLabels]);

  const loadFromHistory = (item: AnalysisResult) => {
    setData(item);
    setMissingColumns(item.missingColumns || []);
    setSelectedLabels(item.labelSummaries.map(l => l.label));
    setSelectedHashtags([]);
    setShowHistory(false);
  };

  const deleteFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
    if (data?.id === id) {
      setData(null);
      setMissingColumns([]);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setData(null);
    setMissingColumns([]);
    setSelectedLabels([]);
    setSelectedHashtags([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: any) => processCSV(results, file.name),
      error: (err: any) => {
        console.error(err);
        alert("Lỗi khi đọc file CSV. Vui lòng kiểm tra định dạng.");
        setLoading(false);
      }
    });
  };

  const handleAIAnalysis = async (currentData: AnalysisResult, currentBonus: number) => {
    setIsAiLoading(true);
    const insight = await getAIInsights(currentData, currentBonus);
    
    setData(prev => prev && prev.id === currentData.id ? { ...prev, aiInsight: insight } : prev);
    setHistory(prev => prev.map(h => h.id === currentData.id ? { ...h, aiInsight: insight } : h));
    
    setIsAiLoading(false);
  };

  const handleExportExcel = () => {
    const exportTarget = filteredData || data;
    if (!exportTarget) return;

    const summarySheetData = exportTarget.labelSummaries.map(item => {
      const bonusUSD = item.totalEarning * (bonusPercentage / 100);
      const bonusVND = bonusUSD * exchangeRate;
      return {
        "Nhãn tùy chỉnh": item.label,
        "Số lượng Video (đã lọc)": item.videoCount,
        "Tổng thu nhập ($)": item.totalEarning.toFixed(2),
        "Hiệu suất ($/Vid)": (item.totalEarning / item.videoCount).toFixed(2),
        [`Bonus ${bonusPercentage}% ($)`]: bonusUSD.toFixed(2),
        "Thành tiền Bonus (VND)": Math.round(bonusVND).toLocaleString('vi-VN')
      };
    });

    const detailSheetData = exportTarget.videoEarnings.map(item => ({
      "Tiêu đề": item.title,
      "Nhãn tùy chỉnh": item.label,
      "Post ID": item.assetId || "N/A",
      "Ngày": item.date || "N/A",
      "Hashtags": item.hashtags.join(', '),
      "Thu nhập ($)": item.totalEarning.toFixed(2),
      "Loại": item.totalEarning < 1 ? "Dưới 1$" : "Trên 1$"
    }));

    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
    const wsDetails = XLSX.utils.json_to_sheet(detailSheetData);

    XLSX.utils.book_append_sheet(wb, wsSummary, "Tổng hợp & Bonus");
    XLSX.utils.book_append_sheet(wb, wsDetails, "Chi tiết Video");

    const dateStr = new Date().toISOString().split('T')[0];
    const fileNameExport = `Thanh_toan_bonus_${bonusPercentage}pt_${dateStr}.xlsx`;

    XLSX.writeFile(wb, fileNameExport);
  };

  const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4'];

  const efficiencies = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.labelSummaries.map(l => l.videoCount > 0 ? l.totalEarning / l.videoCount : 0);
  }, [filteredData]);

  const maxEfficiency = useMemo(() => {
    return efficiencies.length > 0 ? Math.max(...efficiencies) : 0;
  }, [efficiencies]);

  const avgEfficiency = useMemo(() => {
    return efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0;
  }, [efficiencies]);

  // Calculate hashtag frequencies for the entire dataset
  const hashtagCountsMap = useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = {};
    data.videoEarnings.forEach(v => {
      v.hashtags.forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return counts;
  }, [data]);

  const searchedHashtags = useMemo(() => {
    if (!data) return [];
    if (!hashtagSearchQuery) return data.allHashtags;
    return data.allHashtags.filter(tag => tag.toLowerCase().includes(hashtagSearchQuery.toLowerCase()));
  }, [data, hashtagSearchQuery]);

  return (
    <div className="min-h-screen pb-12 bg-slate-50">
      <header className="bg-white border-b sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">B</div>
              <h1 className="text-xl font-bold text-gray-800 tracking-tight hidden sm:block">Earning Analyst</h1>
            </div>
            {data && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 pl-4 border-l border-gray-200">
                <div className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z"></path></svg>
                  <span>{data.startDate} - {data.endDate}</span>
                </div>
                <div className="hidden sm:block text-gray-300">|</div>
                <div className="text-[10px] sm:text-xs text-indigo-600 font-medium italic truncate max-w-[150px] sm:max-w-[250px]">
                  {data.fileName}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
             <button 
               onClick={() => setShowHistory(!showHistory)}
               className={`p-2 rounded-lg transition-colors flex items-center gap-2 ${showHistory ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-100'}`}
               title="Lịch sử lọc"
             >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span className="hidden lg:inline text-sm font-semibold">Lịch sử</span>
             </button>

             {data && (
                <button 
                  onClick={handleExportExcel}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  <span className="hidden sm:inline text-sm font-semibold">Xuất Excel</span>
                </button>
             )}
             <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 sm:px-4 py-2 rounded-lg font-medium cursor-pointer transition-colors text-sm flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                <span className="hidden sm:inline text-sm font-semibold">Lọc File Mới</span>
                <span className="sm:hidden text-sm font-semibold">Tải CSV</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
             </label>
          </div>
        </div>

        {showHistory && (
          <div className="absolute top-16 right-4 w-80 max-w-[calc(100vw-2rem)] bg-white shadow-2xl rounded-2xl border border-gray-100 p-4 mt-2 animate-in slide-in-from-top-4 z-50">
            <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center justify-between">
              Phân tích gần đây
              <span className="text-[10px] text-gray-400 font-medium">Tối đa 10 tệp</span>
            </h3>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {history.length > 0 ? history.map((item) => (
                <div 
                  key={item.id}
                  onClick={() => loadFromHistory(item)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group flex items-start gap-3 ${data?.id === item.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-gray-50 border-gray-100'}`}
                >
                  <div className={`mt-1 p-1.5 rounded-lg ${data?.id === item.id ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-700 truncate">{item.fileName}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{new Date(item.timestamp).toLocaleString('vi-VN')}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] font-black text-indigo-600">${item.grandTotal.toFixed(2)}</span>
                      <button 
                        onClick={(e) => deleteFromHistory(item.id, e)}
                        className="text-[10px] text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all font-bold"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="py-8 text-center text-gray-400 italic text-xs">Chưa có lịch sử lọc</div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8">
        {missingColumns.length > 0 && (
          <div className="mb-6 bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-bold text-amber-800 uppercase tracking-tight">Thiếu cột dữ liệu quan trọng</h3>
                <div className="mt-2 text-xs text-amber-700 font-medium">
                  <p>Tệp CSV của bạn đang thiếu các cột sau: <span className="font-black underline">{missingColumns.join(', ')}</span>.</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Nếu thiếu <span className="font-bold">Post ID</span>: Bạn sẽ không thể bấm link trực tiếp để xem Video trên Facebook.</li>
                    <li>Nếu thiếu <span className="font-bold">Description</span>: Tính năng lọc và trích xuất hashtag sẽ không khả dụng.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {!data && !loading && (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border-2 border-dashed border-gray-200">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-700">Chưa có dữ liệu phân tích</h2>
            <p className="text-gray-500 mt-1 max-w-sm text-center">Vui lòng tải lên tệp CSV từ Facebook hoặc chọn một tệp từ lịch sử để xem lại kết quả.</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600 animate-pulse font-medium">Đang xử lý dữ liệu...</p>
          </div>
        )}

        {data && filteredData && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {/* Top Cards Grid Updated for 7 cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Doanh thu ($)</p>
                <h3 className="text-2xl font-black text-indigo-600">${filteredData.grandTotal.toFixed(2)}</h3>
              </div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Bonus ({bonusPercentage}%)</p>
                <h3 className="text-2xl font-black text-emerald-600">${(filteredData.grandTotal * (bonusPercentage / 100)).toFixed(2)}</h3>
              </div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Thanh toán (VND)</p>
                <h3 className="text-xl font-black text-gray-900">{formatVND(filteredData.grandTotal * (bonusPercentage / 100) * exchangeRate)}</h3>
              </div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tổng số Nhãn</p>
                <div className="flex items-baseline gap-1">
                  <h3 className="text-2xl font-black text-indigo-500">{data.labelSummaries.length}</h3>
                  <span className="text-[10px] text-gray-400 font-medium">Nhãn</span>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Tổng Hashtag</p>
                <div className="flex items-baseline gap-1">
                  <h3 className="text-2xl font-black text-amber-500">{data.allHashtags.length}</h3>
                  <span className="text-[10px] text-gray-400 font-medium">Thẻ</span>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Video &lt; 1$</p>
                <div className="flex items-center gap-2">
                  <h3 className={`text-2xl font-black ${filteredData.lowEarningCount > 0 ? 'text-amber-500' : 'text-gray-400'}`}>
                    {filteredData.lowEarningCount}
                  </h3>
                  <span className="text-[10px] text-gray-400 font-medium">/{filteredData.videoEarnings.length} mục</span>
                </div>
              </div>
              <div className="bg-indigo-600 p-5 rounded-2xl shadow-sm text-white flex flex-col justify-between">
                <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-1">Kết quả lọc</p>
                <div className="flex items-baseline gap-1">
                  <h3 className="text-2xl font-black">{filteredData.videoEarnings.length}</h3>
                  <span className="text-[10px] text-indigo-200">Video</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="lg:col-span-1 flex flex-col gap-6">
                 <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all h-fit">
                    <div className="flex items-center justify-between mb-4">
                       <div className="flex items-center gap-2">
                         <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>
                         <h3 className="font-bold text-gray-800">Bộ lọc Nhãn ({data.labelSummaries.length} nhãn)</h3>
                       </div>
                       <button onClick={() => setShowFilter(!showFilter)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
                          <svg className={`w-5 h-5 transition-transform ${showFilter ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                       </button>
                    </div>
                    {showFilter && (
                      <div className="space-y-4 animate-in slide-in-from-top-2">
                         <div className="flex gap-2">
                            <button onClick={selectAllLabels} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">Tất cả</button>
                            <span className="text-gray-300">|</span>
                            <button onClick={deselectAllLabels} className="text-xs font-semibold text-gray-500 hover:text-gray-700">Bỏ chọn</button>
                         </div>
                         <div className="flex flex-wrap gap-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                            {data.labelSummaries.map((l, i) => (
                              <button
                                key={i}
                                onClick={() => toggleLabel(l.label)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${selectedLabels.includes(l.label) ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                              >
                                {l.label} <span className={`ml-1 opacity-60 text-[10px] ${selectedLabels.includes(l.label) ? 'text-indigo-100' : 'text-gray-400'}`}>({l.videoCount})</span>
                              </button>
                            ))}
                         </div>
                      </div>
                    )}
                 </div>

                 <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all h-fit">
                    <div className="flex items-center justify-between mb-4">
                       <div className="flex items-center gap-2">
                         <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path></svg>
                         <h3 className="font-bold text-gray-800">Lọc theo Hashtag</h3>
                       </div>
                       <button onClick={() => setShowHashtagFilter(!showHashtagFilter)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
                          <svg className={`w-5 h-5 transition-transform ${showHashtagFilter ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                       </button>
                    </div>
                    {showHashtagFilter && (
                      <div className="space-y-4 animate-in slide-in-from-top-2">
                         <div className="relative mb-3">
                           <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                           </span>
                           <input 
                             type="text" 
                             placeholder="Tìm kiếm hashtag..."
                             value={hashtagSearchQuery}
                             onChange={(e) => setHashtagSearchQuery(e.target.value)}
                             className="w-full pl-9 pr-8 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                           />
                           {hashtagSearchQuery && (
                             <button 
                               onClick={() => setHashtagSearchQuery("")}
                               className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-300 hover:text-gray-500"
                             >
                               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                             </button>
                           )}
                         </div>

                         {searchedHashtags.length > 0 ? (
                            <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                               {searchedHashtags.map((tag, i) => (
                                 <button
                                   key={i}
                                   onClick={() => toggleHashtag(tag)}
                                   className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${selectedHashtags.includes(tag) ? 'bg-amber-100 border-amber-500 text-amber-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-500'}`}
                                 >
                                   {tag} <span className={`ml-1 opacity-60 ${selectedHashtags.includes(tag) ? 'text-amber-600' : 'text-gray-400'}`}>({hashtagCountsMap[tag] || 0})</span>
                                 </button>
                               ))}
                            </div>
                         ) : (
                            <p className="text-xs text-gray-400 italic py-2">Không tìm thấy hashtag phù hợp.</p>
                         )}
                         
                         <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-2">
                            <span className="text-[9px] text-gray-400 font-medium">Tìm thấy {searchedHashtags.length} hashtag</span>
                            {selectedHashtags.length > 0 && (
                               <button onClick={() => setSelectedHashtags([])} className="text-[10px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                  Bỏ chọn ({selectedHashtags.length})
                               </button>
                            )}
                         </div>
                      </div>
                    )}
                 </div>

                 <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <div className="space-y-3">
                       <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative">
                             <input 
                               type="checkbox" 
                               className="sr-only" 
                               checked={hideLowEarnings}
                               onChange={() => setHideLowEarnings(!hideLowEarnings)}
                             />
                             <div className={`block w-10 h-6 rounded-full transition-colors ${hideLowEarnings ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                             <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${hideLowEarnings ? 'translate-x-4' : 'translate-x-0'}`}></div>
                          </div>
                          <span className="text-xs font-semibold text-gray-600 group-hover:text-indigo-600 transition-colors">Ẩn video &lt; 1$</span>
                       </label>
                       <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative">
                             <input 
                               type="checkbox" 
                               className="sr-only" 
                               checked={hideLowEarningLabels}
                               onChange={() => setHideLowEarningLabels(!hideLowEarningLabels)}
                             />
                             <div className={`block w-10 h-6 rounded-full transition-colors ${hideLowEarningLabels ? 'bg-rose-500' : 'bg-gray-300'}`}></div>
                             <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${hideLowEarningLabels ? 'translate-x-4' : 'translate-x-0'}`}></div>
                          </div>
                          <span className="text-xs font-semibold text-gray-600 group-hover:text-rose-600 transition-colors">Ẩn Nhãn &lt; 1$</span>
                       </label>
                    </div>
                 </div>
               </div>

               <div className="lg:col-span-2 space-y-6">
                 <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 h-fit">
                    <div className="flex items-center gap-2 mb-4">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      <h3 className="font-bold text-indigo-900">Cấu hình Tính toán</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-semibold text-indigo-700 mb-1 uppercase tracking-wider">Tỉ giá USD (VND)</label>
                        <div className="relative">
                          <input 
                            type="number" 
                            value={exchangeRate}
                            onChange={(e) => setExchangeRate(Number(e.target.value))}
                            className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 text-indigo-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-400 font-medium text-sm">VND</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-indigo-700 mb-1 uppercase tracking-wider">% Bonus</label>
                        <div className="relative">
                          <input 
                            type="number" 
                            step="0.1"
                            value={bonusPercentage}
                            onChange={(e) => setBonusPercentage(Number(e.target.value))}
                            className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-2.5 text-indigo-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-400 font-medium text-sm">%</span>
                        </div>
                      </div>
                    </div>
                 </div>

                 <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800 mb-6">Thống kê Doanh thu ($)</h3>
                    {filteredData.labelSummaries.length > 0 ? (
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={filteredData.labelSummaries}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                            <Tooltip 
                              cursor={{fill: '#f8fafc'}}
                              contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                            />
                            <Bar dataKey="totalEarning" radius={[4, 4, 0, 0]}>
                              {filteredData.labelSummaries.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-64 flex items-center justify-center text-gray-400 text-sm italic">Không có dữ liệu</div>
                    )}
                 </div>
               </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-2">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  Bảng tính Bonus & Đánh giá hiệu quả
                  {(hideLowEarnings || hideLowEarningLabels || selectedHashtags.length > 0) && (
                    <span className="text-[10px] bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-bold">
                      Đã lọc
                    </span>
                  )}
                </h3>
                <span className="text-xs font-medium text-gray-400">{filteredData.labelSummaries.length} nhãn</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b">
                      <th className="pb-4 px-2">Nhãn / Xếp hạng</th>
                      <th className="pb-4 px-2">Số Video</th>
                      <th className="pb-4 px-2 text-center">Đánh giá Hiệu quả</th>
                      <th className="pb-4 px-2 text-right">Doanh thu ($)</th>
                      <th className="pb-4 px-2 text-right text-emerald-600">Bonus ($)</th>
                      <th className="pb-4 px-2 text-right text-indigo-600 font-extrabold">Thành tiền (VND)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredData.labelSummaries.map((item, i) => {
                      const bonusUSD = item.totalEarning * (bonusPercentage / 100);
                      const bonusVND = bonusUSD * exchangeRate;
                      const efficiency = item.videoCount > 0 ? item.totalEarning / item.videoCount : 0;
                      
                      const isTopEfficiency = efficiency === maxEfficiency && efficiency > 0;
                      
                      let efficiencyLabel = "Trung bình";
                      let efficiencyColor = "bg-slate-100 text-slate-500";
                      
                      if (efficiency > avgEfficiency * 1.5) {
                        efficiencyLabel = "Xuất sắc";
                        efficiencyColor = "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300";
                      } else if (efficiency > avgEfficiency) {
                        efficiencyLabel = "Tốt";
                        efficiencyColor = "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300";
                      }

                      let rankStyle = '';
                      let rankBadge = null;
                      if (i === 0) {
                        rankStyle = 'bg-green-50/50 border-l-4 border-l-green-500';
                        rankBadge = <span className="ml-2 px-1.5 py-0.5 bg-green-500 text-white text-[9px] font-black rounded uppercase">Top 1 Revenue</span>;
                      } else if (i === 1) {
                        rankStyle = 'bg-amber-50/50 border-l-4 border-l-amber-400';
                        rankBadge = <span className="ml-2 px-1.5 py-0.5 bg-amber-400 text-white text-[9px] font-black rounded uppercase">Top 2 Revenue</span>;
                      } else if (i === 2) {
                        rankStyle = 'bg-slate-50 border-l-4 border-l-slate-300';
                        rankBadge = <span className="ml-2 px-1.5 py-0.5 bg-slate-300 text-gray-700 text-[9px] font-black rounded uppercase">Top 3 Revenue</span>;
                      }

                      return (
                        <tr key={i} className={`hover:bg-gray-50 transition-colors group ${rankStyle}`}>
                          <td className="py-4 px-2">
                            <div className="flex items-center">
                              <span className="font-bold text-gray-700">{item.label}</span>
                              {rankBadge}
                            </div>
                          </td>
                          <td className="py-4 px-2 text-gray-500">{item.videoCount}</td>
                          <td className="py-4 px-2">
                             <div className="flex flex-col items-center gap-1">
                                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold shadow-sm transition-all ${isTopEfficiency ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400' : efficiencyColor}`}>
                                   ${efficiency.toFixed(2)} / video
                                   {isTopEfficiency && (
                                     <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                                       <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                     </svg>
                                   )}
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-tighter ${isTopEfficiency ? 'text-amber-600' : efficiencyColor.split(' ')[1]}`}>
                                  {isTopEfficiency ? "Hiệu suất Cao nhất" : efficiencyLabel}
                                </span>
                             </div>
                          </td>
                          <td className="py-4 px-2 text-right font-medium text-gray-600">
                            <span className={i < 3 ? 'font-black' : ''}>${item.totalEarning.toFixed(2)}</span>
                          </td>
                          <td className="py-4 px-2 text-right font-bold text-emerald-600">${bonusUSD.toFixed(2)}</td>
                          <td className="py-4 px-2 text-right">
                             <div className={`px-3 py-1.5 rounded-lg inline-block font-extrabold min-w-[120px] ${i < 3 ? 'bg-indigo-100 text-indigo-800' : 'bg-indigo-50 text-indigo-700'}`}>
                                {formatVND(bonusVND)}
                             </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-gray-800">Chi tiết Video</h3>
                    <span className="text-xs text-gray-400">{filteredData.videoEarnings.length} video</span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                    {filteredData.videoEarnings.length > 0 ? (
                      <table className="w-full text-left">
                        <thead className="sticky top-0 bg-white shadow-sm z-10">
                          <tr className="text-xs font-bold text-gray-400 uppercase border-b">
                            <th className="py-3 px-2">Tiêu đề & ID</th>
                            <th className="py-3 px-2 text-right">Thu nhập ($)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {filteredData.videoEarnings.map((item, i) => (
                            <tr key={i} className={`hover:bg-gray-50 transition-colors ${item.totalEarning < 1 ? 'bg-amber-50/30' : ''}`}>
                              <td className="py-3 px-2">
                                <div className="flex flex-col gap-1">
                                  <div className="text-[11px] font-medium text-gray-700 leading-normal line-clamp-2">
                                    {item.title}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {item.assetId && (
                                      <a 
                                        href={`https://www.facebook.com/reel/${item.assetId}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-[9px] text-indigo-500 hover:text-indigo-700 font-bold hover:underline flex items-center gap-1"
                                      >
                                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                                        ID: {item.assetId}
                                      </a>
                                    )}
                                    {item.hashtags.map((tag, idx) => (
                                      <span key={idx} className="text-[8px] bg-gray-100 text-gray-400 px-1 rounded uppercase font-bold">
                                        {tag}
                                      </span>
                                    ))}
                                    {item.totalEarning < 1 && (
                                      <span className="inline-block text-[8px] font-black uppercase tracking-tighter text-amber-600 border border-amber-200 bg-amber-50 px-1 rounded">
                                        Low
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-2 text-right">
                                 <span className={`font-bold ${item.totalEarning < 1 ? 'text-amber-600' : 'text-gray-900'}`}>
                                    ${item.totalEarning.toFixed(2)}
                                 </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="py-12 text-center text-gray-400 italic">Trống</div>
                    )}
                  </div>
               </div>

               <div className="space-y-6 flex flex-col">
                  <div className="bg-indigo-900 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden flex-1">
                     <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="bg-indigo-500 p-2 rounded-lg">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                          </div>
                          <h2 className="text-xl font-bold">Trợ lý Gemini</h2>
                        </div>
                        {isAiLoading ? (
                          <div className="flex items-center gap-3">
                             <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                             <span>Đang phân tích {filteredData.videoEarnings.length} video...</span>
                          </div>
                        ) : (
                          <div>
                            <p className="text-indigo-100 leading-relaxed whitespace-pre-wrap mb-6 text-sm">
                              {data.aiInsight || "Bấm nút để nhận phân tích chuyên sâu."}
                            </p>
                            <button 
                              onClick={() => handleAIAnalysis(data, bonusPercentage)} 
                              className="bg-white text-indigo-900 px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-50 transition-all shadow-lg active:scale-95 flex items-center gap-2"
                            >
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.989-2.386l-.548-.547z"></path></svg>
                               Tạo phân tích AI
                            </button>
                          </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 mt-16 text-center text-gray-400 text-sm pb-8">
        &copy; 2025 Earning & Bonus Analyst Tool
      </footer>
    </div>
  );
};

export default App;
