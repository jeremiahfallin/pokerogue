// src/run-server.ts
import { PokerogueWebSocketServer } from './websocket-server.js'; // Added .js extension

const server = new PokerogueWebSocketServer();

console.log('Pokerogue WebSocket Server runner started. Listening on ws://localhost:8080.');
console.log('Press Ctrl+C to shut down the server.');

// Keep the process alive until explicitly closed or error
process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down server...');
    server.close();
    // Allow time for server.close() to complete its async operations if any
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down server...');
    server.close();
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

// Handle other unexpected errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    server.close();
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close();
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});
