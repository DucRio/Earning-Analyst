
import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";

export const getAIInsights = async (data: AnalysisResult, bonusPercentage: number): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `
      Dưới đây là dữ liệu thu nhập từ nội dung video:
      - Tổng thu nhập toàn bộ: ${data.grandTotal.toFixed(2)} USD
      - Tỉ lệ tính bonus hiện tại: ${bonusPercentage}%
      - Tổng số video: ${data.videoEarnings.length}
      - Số video có thu nhập thấp (dưới 1 USD): ${data.lowEarningCount}
      - Tóm tắt theo nhãn tùy chỉnh:
      ${data.labelSummaries.map(s => `+ Nhãn "${s.label}": ${s.totalEarning.toFixed(2)} USD (${s.videoCount} video)`).join('\n')}
      
      Hãy phân tích ngắn gọn kết quả này. Chỉ ra nhãn nào hiệu quả nhất. 
      Đặc biệt nhận xét về tỉ lệ video thu nhập thấp (${data.lowEarningCount}/${data.videoEarnings.length}) và đưa ra lời khuyên có nên tiếp tục sản xuất nội dung theo các nhãn đó không. 
      Đưa ra 2-3 lời khuyên để tối ưu hóa thu nhập và Bonus ${bonusPercentage}%. 
      Viết bằng tiếng Việt, giọng điệu chuyên nghiệp, súc tích.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "Không thể tạo phân tích lúc này.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Đã xảy ra lỗi khi kết nối với trí tuệ nhân tạo để phân tích dữ liệu.";
  }
};
