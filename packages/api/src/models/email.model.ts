export interface Email {
  id: string;
  subject: string;
  body: string;
  from: string;
  date: Date;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  attachments?: {
    filename: string;
    contentType: string;
    size: number;
  }[];
} 