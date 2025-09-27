# Contributing to Cross-Chain Safe Escrow System

Thank you for your interest in contributing to the Cross-Chain Safe Escrow System! This document provides guidelines for contributing to the project.

## Development Setup

1. **Prerequisites**
   - Node.js 18+ 
   - Foundry (for Ethereum contracts)
   - Sui CLI (for Sui contracts)
   - Git

2. **Installation**
   ```bash
   git clone <repository-url>
   cd newResolver
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Build Contracts**
   ```bash
   # Ethereum contracts
   cd contracts/ethereum
   forge build
   
   # Sui contracts
   cd ../sui
   sui move build
   ```

## Code Style

- Use ESLint and Prettier for JavaScript code formatting
- Follow Solidity style guide for smart contracts
- Use Move formatting conventions for Sui contracts
- Write descriptive commit messages

## Testing

Run tests before submitting:

```bash
# JavaScript tests
npm test

# Ethereum contract tests
cd contracts/ethereum
forge test

# Sui contract tests
cd contracts/sui
sui move test
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Add tests for new functionality
5. Run all tests and ensure they pass
6. Run linting: `npm run lint`
7. Format code: `npm run format`
8. Commit your changes with clear messages
9. Push to your fork and submit a pull request

## Reporting Issues

When reporting issues, please include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)
- Relevant logs or error messages

## Security

For security-related issues, please email [security contact] instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.