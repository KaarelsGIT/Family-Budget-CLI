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
  name: string;
  type: 'INCOME' | 'EXPENSE';
  parentCategoryId: number | null;
  parentCategoryName: string | null;
  group: 'FAMILY' | 'CHILD';
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
  subcategoryId: number | null;
  from: string | null;
  to: string | null;
}

export interface TransactionListResult {
  data: TransactionItem[];
  total: number;
}
