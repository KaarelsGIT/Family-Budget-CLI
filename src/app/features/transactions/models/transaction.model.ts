export interface TransactionItem {
  id: number;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  fromAccountId: number | null;
  fromAccountName: string | null;
  toAccountId: number | null;
  toAccountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  createdById: number;
  createdByUsername: string;
  transactionDate: string;
  createdAt: string;
  comment: string | null;
}

export interface TransactionCategory {
  id: number;
  userId: number;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  parentCategoryId: number | null;
  parentCategoryName: string | null;
  group: 'FAMILY' | 'CHILD';
  isRecurring: boolean;
  dueDayOfMonth: number | null;
}

export interface TransactionUserOption {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
}

export interface TransactionQuery {
  page: number;
  size: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  userId: number | null;
  categoryId: number | null;
  from: string | null;
  to: string | null;
}

export interface TransactionListResult {
  data: TransactionItem[];
  total: number;
}

export interface CreateTransactionPayload {
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  accountId: number;
  toAccountId?: number | null;
  transferFromAccountId?: number | null;
  transferToAccountId?: number | null;
  categoryId: number | null;
  transactionDate: string;
  comment?: string | null;
}

export interface CreateTransactionCategoryPayload {
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  parentCategoryId: number | null;
  group: 'FAMILY' | 'CHILD';
  isRecurring?: boolean;
  dueDayOfMonth?: number | null;
}

export interface TransactionOpenRequest {
  categoryId: number;
  accountId?: number | null;
  amount?: string | null;
  transactionDate?: string | null;
  comment?: string | null;
}

export interface TransactionDraft {
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  accountId: number | null;
  transferFromAccountId: number | null;
  transferToAccountId: number | null;
  toAccountId: number | null;
  mainCategoryId: number | null;
  categoryId: number | null;
  transactionDate: string;
  amount: string;
  comment: string;
}
