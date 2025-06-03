import { EmailService } from '@/services/email.service';

describe('EmailService', () => {
  let emailService: EmailService;

  beforeEach(() => {
    emailService = new EmailService();
  });

  describe('summarizeEmails', () => {
    it('should summarize a list of emails', async () => {
      const mockEmails = [
        {
          id: '1',
          subject: 'Test Email 1',
          body: 'This is a test email body',
          from: 'test@example.com',
          date: new Date(),
        },
      ];

      const summary = await emailService.summarizeEmails(mockEmails);

      expect(summary).toBeDefined();
      expect(summary).toHaveProperty('summary');
      expect(summary).toHaveProperty('importantPoints');
    });

    it('should handle empty email list', async () => {
      const summary = await emailService.summarizeEmails([]);

      expect(summary).toBeDefined();
      expect(summary.summary).toBe('');
      expect(summary.importantPoints).toHaveLength(0);
    });
  });
}); 