/**
 * KodeChain Web SDK
 * Official JavaScript/TypeScript SDK for KodeChain blockchain
 */

// Core
export * from './core';

// Types
export * from './types';

// Errors
export * from './errors';

// Utils
export * from './utils';

// Contracts
export * from './contracts';

// Accounts
export * from './accounts';

// Transactions
export { TransactionBuilder, TransactionHistory } from './transactions';
export { Transaction as TransactionClass } from './transactions/Transaction';
export * from './transactions/TransactionReceipt';

// Consensus
export * from './consensus';

// Gas
export * from './gas';

// Faucet (testnet)
export * from './faucet';

// Mempool
export * from './mempool';

// Chain explorer (blocks, heights, address history)
export * from './explorer';

// Re-export main client as default
export { KodeChainClient as default } from './core';
