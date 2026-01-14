
export interface RawCSVRow {
  "Tiêu đề"?: string;
  "Title"?: string;
  "Nhãn tùy chỉnh"?: string;
  "Custom labels"?: string;
  "Thu nhập ước tính khi tham gia chương trình kiếm tiền từ nội dung"?: string | number;
  "Approximate content monetization earnings"?: string | number;
  "Ngày"?: string;
  "Date"?: string;
  "Video asset ID"?: string;
  "ID tài sản video"?: string;
  "Post ID"?: string;
  "Description"?: string;
  "Mô tả"?: string;
  [key: string]: any;
}

export interface VideoEarning {
  title: string;
  label: string;
  totalEarning: number;
  assetId?: string;
  date?: string;
  hashtags: string[];
}

export interface LabelSummary {
  label: string;
  totalEarning: number;
  videoCount: number;
}

export interface AnalysisResult {
  id: string;
  fileName: string;
  timestamp: number;
  videoEarnings: VideoEarning[];
  labelSummaries: LabelSummary[];
  grandTotal: number;
  lowEarningCount: number;
  startDate?: string;
  endDate?: string;
  allHashtags: string[];
  aiInsight?: string | null;
  missingColumns: string[];
}
