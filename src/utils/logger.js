import fs from 'fs';
import path from 'path';

class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logToFile = process.env.LOG_TO_FILE === 'true';
        this.logDir = process.env.LOG_DIR || './logs';
        
        if (this.logToFile) {
            this._ensureLogDirectory();
        }
    }

    _ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    _getLogLevel(level) {
        const levels = { error: 0, warn: 1, info: 2, debug: 3 };
        return levels[level] || 2;
    }

    _shouldLog(level) {
        return this._getLogLevel(level) <= this._getLogLevel(this.logLevel);
    }

    _formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
        
        if (data) {
            return `${prefix} ${message} ${JSON.stringify(data, null, 2)}`;
        }
        return `${prefix} ${message}`;
    }

    _writeToFile(level, formattedMessage) {
        if (!this.logToFile) return;

        const logFile = path.join(this.logDir, `${level}.log`);
        const allLogFile = path.join(this.logDir, 'all.log');
        
        fs.appendFileSync(logFile, formattedMessage + '\n');
        fs.appendFileSync(allLogFile, formattedMessage + '\n');
    }

    _log(level, message, data = null) {
        if (!this._shouldLog(level)) return;

        const formattedMessage = this._formatMessage(level, message, data);
        
        // Console output with colors
        switch (level) {
        case 'error':
            console.error('\x1b[31m%s\x1b[0m', formattedMessage);
            break;
        case 'warn':
            console.warn('\x1b[33m%s\x1b[0m', formattedMessage);
            break;
        case 'info':
            console.info('\x1b[36m%s\x1b[0m', formattedMessage);
            break;
        case 'debug':
            console.debug('\x1b[35m%s\x1b[0m', formattedMessage);
            break;
        default:
            console.log(formattedMessage);
        }

        // File output
        this._writeToFile(level, formattedMessage);
    }

    error(message, data = null) {
        this._log('error', message, data);
    }

    warn(message, data = null) {
        this._log('warn', message, data);
    }

    info(message, data = null) {
        this._log('info', message, data);
    }

    debug(message, data = null) {
        this._log('debug', message, data);
    }

    // Transaction logging with special formatting
    logTransaction(chain, operation, txData) {
        const message = `${chain.toUpperCase()} ${operation}`;
        const data = {
            txHash: txData.txHash || txData.digest,
            blockNumber: txData.blockNumber,
            gasUsed: txData.gasUsed,
            timestamp: new Date().toISOString(),
            ...txData
        };
        
        this.info(message, data);
    }

    // Error logging with stack trace
    logError(message, error, context = {}) {
        const errorData = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            context
        };
        
        this.error(message, errorData);
    }

    // Performance logging
    logPerformance(operation, startTime, endTime, metadata = {}) {
        const duration = endTime - startTime;
        const data = {
            operation,
            duration: `${duration}ms`,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            ...metadata
        };
        
        this.info('Performance', data);
    }

    // Safe operation logging
    logSafeOperation(operation, chain, safeId, metadata = {}) {
        const message = `Safe ${operation}`;
        const data = {
            chain,
            safeId,
            operation,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        this.info(message, data);
    }

    // Cross-chain operation logging
    logCrossChainOperation(operation, sourceChain, destChain, metadata = {}) {
        const message = `Cross-chain ${operation}`;
        const data = {
            operation,
            sourceChain,
            destChain,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        this.info(message, data);
    }

    // Event logging
    logEvent(eventName, eventData, source = 'system') {
        const message = `Event: ${eventName}`;
        const data = {
            event: eventName,
            source,
            timestamp: new Date().toISOString(),
            ...eventData
        };
        
        this.info(message, data);
    }

    // Relayer operation logging
    logRelayerOperation(operation, success, metadata = {}) {
        const message = `Relayer ${operation} ${success ? 'succeeded' : 'failed'}`;
        const level = success ? 'info' : 'error';
        const data = {
            operation,
            success,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        
        this._log(level, message, data);
    }
}

export const logger = new Logger();