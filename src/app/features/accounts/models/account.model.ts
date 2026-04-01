export interface Account {
  id: number;
  name: string;
  balance: number;
  type: 'MAIN' | 'SAVINGS' | 'GOAL' | 'CASH';
  ownerId: number;
  ownerUsername: string;
  ownerRole: 'ADMIN' | 'PARENT' | 'CHILD';
}
