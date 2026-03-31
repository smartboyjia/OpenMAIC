export { getBillingDB } from './db';
export type { UserRow, LedgerRow, TransactionRow, ReferralCodeRow, ReferralUseRow } from './db';

export {
  getBalance,
  getLedger,
  giftPages,
  deductPages,
  hasEnoughPages,
  createRechargeTransaction,
  markTransactionPaid,
  getTransactions,
  getUserById,
  getUserByEmail,
  listUsers,
  InsufficientPagesError,
  InsufficientTokensError,
  PACKAGES,
  GIFT_PAGES_ON_REGISTER,
} from './service';
export type { PackageId } from './service';

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

export {
  getOrCreateUserReferralCode,
  lookupReferralCode,
  applyReferralCode,
  getUserReferralStats,
} from './referral';
export type { ApplyReferralResult, ReferralStats } from './referral';

