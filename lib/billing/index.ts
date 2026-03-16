/**
 * Billing module barrel export
 */

export { getBillingDB } from './db';
export type { UserRow, LedgerRow, TransactionRow } from './db';

export {
  getBalance,
  getLedger,
  giftTokens,
  deductTokens,
  hasEnoughTokens,
  createRechargeTransaction,
  markTransactionPaid,
  getTransactions,
  getUserById,
  getUserByEmail,
  listUsers,
  InsufficientTokensError,
  TOKEN_PER_CNY,
  GIFT_TOKENS_ON_REGISTER,
} from './service';

export {
  registerUser,
  loginUser,
  signJWT,
  verifyJWT,
  setAuthCookie,
  clearAuthCookie,
  getSessionFromCookie,
  requireAuth,
  requireAdmin,
} from './auth';

export { billingGuard, isBillingEnabled } from './guard';
