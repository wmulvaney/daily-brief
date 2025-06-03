# Daily Brief

An AI-powered email summarization and batching tool that helps you manage your inbox more efficiently.

## Features

- 📧 Email summarization and batching
- 🕒 Customizable notification timing
- 📱 Web dashboard for viewing summaries
- 🔌 Chrome extension for quick access
- 📨 Email delivery of daily summaries

## Project Structure

This is a monorepo containing the following packages:

- `packages/api` - Backend API service
- `packages/web` - Web dashboard
- `packages/chrome-extension` - Chrome extension
- `packages/shared` - Shared types and utilities

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Docker
- PostgreSQL
- Redis

### Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
4. Start the development servers:
   ```bash
   pnpm dev
   ```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
