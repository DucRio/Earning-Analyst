
import React, { useState, useCallback } from 'react';
import { AnalysisResult, RawCSVRow, VideoEarning, LabelSummary } from './types';
import { getAIInsights } from './services/geminiService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import * as XLSX from 'xlsx';

// Global PapaParse availability from script tag
declare const Papa: any;

const App: React.FC = () => {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const processCSV = (results: any) => {
    const rows: RawCSVRow[] = results.data;
    const videoMap = new Map<string, VideoEarning>();
    const labelMap = new Map<string, { total: number; count: Set<string> }>();
    const dates: Date[] = [];

    rows.forEach((row) => {
      const title = row["Tiêu đề"]?.trim();
      const label = row["Nhãn tùy chỉnh"]?.trim() || "Không có nhãn";
      const dateStr = row["Ngày"]?.trim();
      let earningStr = row["Thu nhập ước tính khi tham gia chương trình kiếm tiền từ nội dung"];
      
      // Handle Date extraction
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          dates.push(parsedDate);
        }
      }

      // Clean up earning string and convert to number
      let earning = 0;
      if (typeof earningStr === 'string') {
        earning = parseFloat(earningStr.replace(/,/g, '')) || 0;
      } else if (typeof earningStr === 'number') {
        earning = earningStr;
      }

      if (!title) return;

      // Aggregate by Title + Label
      const key = `${title}-${label}`;
      if (videoMap.has(key)) {
        const existing = videoMap.get(key)!;
        existing.totalEarning += earning;
      } else {
        videoMap.set(key, { title, label, totalEarning: earning, date: dateStr });
      }

      // Aggregate by Label
      if (!labelMap.has(label)) {
        labelMap.set(label, { total: 0, count: new Set() });
      }
      const lblData = labelMap.get(label)!;
      lblData.total += earning;
      lblData.count.add(title);
    });

    const videoEarnings = Array.from(videoMap.values()).sort((a, b) => b.totalEarning - a.totalEarning);
    const labelSummaries: LabelSummary[] = Array.from(labelMap.entries()).map(([label, info]) => ({
      label,
      totalEarning: info.total,
      videoCount: info.count.size
    })).sort((a, b) => b.totalEarning - a.totalEarning);

    const grandTotal = labelSummaries.reduce((acc, curr) => acc + curr.totalEarning, 0);

    // Calculate Date Range
    let startDate, endDate;
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
      const formatDate = (d: Date) => d.toLocaleDateString('vi-VN');
      startDate = formatDate(minDate);
      endDate = formatDate(maxDate);
    }

    const finalResult: AnalysisResult = { 
      videoEarnings, 
      labelSummaries, 
      grandTotal,
      startDate,
      endDate
    };
    
    setData(finalResult);
    setLoading(false);
    
    // Auto-trigger AI analysis
    handleAIAnalysis(finalResult);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setData(null);
    setAiInsight(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: processCSV,
      error: (err: any) => {
        console.error(err);
        alert("Lỗi khi đọc file CSV. Vui lòng kiểm tra định dạng.");
        setLoading(false);
      }
    });
  };

  const handleAIAnalysis = async (currentData: AnalysisResult) => {
    setIsAiLoading(true);
    const insight = await getAIInsights(currentData);
    setAiInsight(insight);
    setIsAiLoading(false);
  };

  const handleExportExcel = () => {
    if (!data) return;

    // Prepare Summary Sheet
    const summarySheetData = data.labelSummaries.map(item => ({
      "Nhãn tùy chỉnh": item.label,
      "Số lượng Video": item.videoCount,
      "Tổng thu nhập ($)": item.totalEarning.toFixed(2)
    }));
    summarySheetData.push({
        "Nhãn tùy chỉnh": "TỔNG CỘNG",
        "Số lượng Video": data.videoEarnings.length,
        "Tổng thu nhập ($)": data.grandTotal.toFixed(2)
    } as any);

    // Prepare Details Sheet
    const detailSheetData = data.videoEarnings.map(item => ({
      "Tiêu đề": item.title,
      "Nhãn tùy chỉnh": item.label,
      "Ngày": item.date || "N/A",
      "Thu nhập ($)": item.totalEarning.toFixed(2)
    }));

    // Create workbook and add sheets
    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
    const wsDetails = XLSX.utils.json_to_sheet(detailSheetData);

    XLSX.utils.book_append_sheet(wb, wsSummary, "Tổng hợp theo nhãn");
    XLSX.utils.book_append_sheet(wb, wsDetails, "Chi tiết Video");

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `Bao_cao_thu_nhap_${dateStr}.xlsx`;

    // Write file
    XLSX.writeFile(wb, fileName);
  };

  const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4'];

  return (
    <div className="min-h-screen pb-12">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">B</div>
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">Earning Analyst</h1>
          </div>
          <div className="flex items-center gap-3">
             {data && (
                <button 
                  onClick={handleExportExcel}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                  Xuất Excel
                </button>
             )}
             <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium cursor-pointer transition-colors text-sm flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                Tải lên CSV
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
             </label>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8">
        {!data && !loading && (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-2xl border-2 border-dashed border-gray-200">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-700">Chưa có dữ liệu</h2>
            <p className="text-gray-500 mt-1">Vui lòng tải lên tệp CSV từ Facebook Creator Studio để bắt đầu phân tích.</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="mt-4 text-gray-600 animate-pulse">Đang xử lý dữ liệu...</p>
          </div>
        )}

        {data && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-sm font-medium text-gray-500 mb-1">Tổng thu nhập ước tính</p>
                <h3 className="text-3xl font-bold text-gray-900">${data.grandTotal.toFixed(2)}</h3>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-sm font-medium text-gray-500 mb-1">Tổng số Video</p>
                <h3 className="text-3xl font-bold text-gray-900">{data.videoEarnings.length}</h3>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-sm font-medium text-gray-500 mb-1">Số lượng Nhãn</p>
                <h3 className="text-3xl font-bold text-gray-900">{data.labelSummaries.length}</h3>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center">
                <p className="text-sm font-medium text-gray-500 mb-1">Khoảng thời gian file</p>
                <div className="flex items-center gap-2 text-gray-900">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <span className="font-bold">
                    {data.startDate ? `${data.startDate} - ${data.endDate}` : "Không có dữ liệu ngày"}
                  </span>
                </div>
              </div>
            </div>

            {/* AI Insight Section */}
            <div className="bg-indigo-900 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-4 opacity-10">
                  <svg className="w-48 h-48" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path></svg>
               </div>
               <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="bg-indigo-500 p-1.5 rounded-md">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </span>
                    <h2 className="text-xl font-bold">Phân tích bằng AI</h2>
                  </div>
                  {isAiLoading ? (
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-white rounded-full animate-bounce"></div>
                      <div className="w-4 h-4 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-4 h-4 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <span className="ml-2 text-indigo-200">Gemini đang suy nghĩ...</span>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none">
                      <p className="text-indigo-100 leading-relaxed whitespace-pre-wrap">
                        {aiInsight || "Bấm nút bên dưới để bắt đầu phân tích dữ liệu chuyên sâu."}
                      </p>
                      {!aiInsight && (
                        <button 
                          onClick={() => handleAIAnalysis(data)}
                          className="mt-4 bg-white text-indigo-900 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-indigo-50 transition-colors"
                        >
                          Tạo phân tích
                        </button>
                      )}
                    </div>
                  )}
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               {/* Label Summary Table & Chart */}
               <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-bold text-gray-800">Hiệu suất theo Nhãn</h3>
                      <button onClick={handleExportExcel} className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        Tải bảng này
                      </button>
                    </div>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.labelSummaries}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                          <Tooltip 
                            cursor={{fill: '#f8fafc'}}
                            contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                          />
                          <Bar dataKey="totalEarning" radius={[4, 4, 0, 0]}>
                            {data.labelSummaries.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    
                    <div className="mt-8 overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b">
                            <th className="pb-3 px-2">Nhãn</th>
                            <th className="pb-3 px-2">Video</th>
                            <th className="pb-3 px-2 text-right">Tổng thu nhập</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {data.labelSummaries.map((item, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                              <td className="py-4 px-2 font-medium text-gray-700">{item.label}</td>
                              <td className="py-4 px-2 text-gray-500">{item.videoCount}</td>
                              <td className="py-4 px-2 text-right font-bold text-indigo-600">${item.totalEarning.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
               </div>

               {/* Video Details Table */}
               <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-full">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-gray-800">Chi tiết theo Tiêu đề</h3>
                    {data.startDate && (
                      <span className="text-xs font-medium text-gray-400 italic">Dữ liệu từ: {data.startDate}</span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
                    <table className="w-full text-left">
                      <thead className="sticky top-0 bg-white shadow-sm z-10">
                        <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b">
                          <th className="py-3 px-2 w-2/3">Tiêu đề</th>
                          <th className="py-3 px-2">Nhãn</th>
                          <th className="py-3 px-2 text-right">Thu nhập</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.videoEarnings.map((item, i) => (
                          <tr key={i} className="hover:bg-gray-50 group">
                            <td className="py-4 px-2">
                              <div className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug" title={item.title}>
                                {item.title}
                              </div>
                              {item.date && (
                                <div className="text-[10px] text-gray-400 mt-1">{item.date}</div>
                              )}
                            </td>
                            <td className="py-4 px-2">
                              <span className="text-[10px] uppercase font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded-md whitespace-nowrap">
                                {item.label}
                              </span>
                            </td>
                            <td className="py-4 px-2 text-right">
                              <span className="text-sm font-bold text-gray-700">${item.totalEarning.toFixed(2)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="pt-4 border-t mt-auto text-center text-xs text-gray-400">
                    Sắp xếp theo thu nhập giảm dần
                  </div>
               </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-4 mt-16 text-center text-gray-400 text-sm">
        &copy; 2025 Earning Analyst Tool - TuanDuc BHD
      </footer>
    </div>
  );
};

export default App;
