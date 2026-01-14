
export interface RawCSVRow {
  "Tiêu đề": string;
  "Nhãn tùy chỉnh": string;
  "Thu nhập ước tính khi tham gia chương trình kiếm tiền từ nội dung": string | number;
  "Ngày"?: string;
  [key: string]: any;
}

export interface VideoEarning {
  title: string;
  label: string;
  totalEarning: number;
  date?: string;
}

export interface LabelSummary {
  label: string;
  totalEarning: number;
  videoCount: number;
}

export interface AnalysisResult {
  videoEarnings: VideoEarning[];
  labelSummaries: LabelSummary[];
  grandTotal: number;
  startDate?: string;
  endDate?: string;
}
