export interface Account {
  id: number;
  name: string;
  balance: number;
  type: 'MAIN' | 'SAVINGS' | 'SUB_ACCOUNT' | 'CASH';
  targetAmount?: number | null;
  targetDate?: string | null;
  ownerId: number;
  ownerUsername: string;
  ownerRole: 'ADMIN' | 'PARENT' | 'CHILD';
  accessRole: 'OWNER' | 'EDITOR' | 'VIEWER' | null;
  sharedUsers?: AccountSharedUser[];
}

export interface AccountSharedUser {
  userId: number;
  username: string;
  role: 'EDITOR' | 'VIEWER';
}

export interface AccountMonthlySummary {
  income: number;
  expenses: number;
}
