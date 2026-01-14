
import { GoogleGenAI } from "@google/genai";
import { AnalysisResult } from "../types";

export const getAIInsights = async (data: AnalysisResult): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `
      Dưới đây là dữ liệu thu nhập từ nội dung video:
      - Tổng thu nhập toàn bộ: ${data.grandTotal.toFixed(2)} USD
      - Tóm tắt theo nhãn tùy chỉnh:
      ${data.labelSummaries.map(s => `+ Nhãn "${s.label}": ${s.totalEarning.toFixed(2)} USD (${s.videoCount} video)`).join('\n')}
      
      Hãy phân tích ngắn gọn kết quả này, chỉ ra nhãn nào hiệu quả nhất và đưa ra 2-3 lời khuyên để tối ưu hóa thu nhập dựa trên số lượng video và hiệu suất của từng nhãn. Viết bằng tiếng Việt, giọng điệu chuyên nghiệp, súc tích.
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
