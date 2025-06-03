import { OpenAI } from 'openai';
import { Email } from '@/models/email.model';

export interface EmailSummary {
  summary: string;
  importantPoints: string[];
}

export class EmailService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async summarizeEmails(emails: Email[]): Promise<EmailSummary> {
    if (emails.length === 0) {
      return {
        summary: '',
        importantPoints: [],
      };
    }

    const emailTexts = emails.map(email => `
      From: ${email.from}
      Subject: ${email.subject}
      Body: ${email.body}
    `).join('\n\n');

    const prompt = `Please summarize the following emails and extract important points:\n\n${emailTexts}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are an email summarization assistant. Provide a concise summary and list important points."
          },
          {
            role: "user",
            content: prompt
          }
        ],
      });

      const response = completion.choices[0].message.content;
      
      // Parse the response to extract summary and important points
      const [summary, ...points] = response?.split('\n') || [];
      
      return {
        summary: summary || '',
        importantPoints: points.filter(point => point.trim().length > 0),
      };
    } catch (error) {
      console.error('Error summarizing emails:', error);
      throw new Error('Failed to summarize emails');
    }
  }
} 