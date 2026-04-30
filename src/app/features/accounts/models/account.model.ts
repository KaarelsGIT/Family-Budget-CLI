export interface Account {
  id: number;
  name: string;
  balance: number;
  type: 'MAIN' | 'SAVINGS' | 'SUB_ACCOUNT' | 'CASH';
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
