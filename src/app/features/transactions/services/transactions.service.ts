import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import {
  TransactionCategory,
  TransactionItem,
  TransactionListResult,
  TransactionQuery,
  TransactionUserOption
} from '../models/transaction.model';

interface ListResponse<T> {
  data: T;
  total: number;
}

interface ApiResponse<T> {
  data: T;
}

interface TransactionApiResponse {
  id: number;
  amount: number | string | null;
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

interface CategoryApiResponse {
  id: number;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  parentCategoryId: number | null;
  parentCategoryName: string | null;
  group: 'FAMILY' | 'CHILD';
}

interface UserApiResponse {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
}

@Injectable({
  providedIn: 'root'
})
export class TransactionsService {
  private readonly http = inject(HttpClient);

  getTransactions(query: TransactionQuery): Observable<TransactionListResult> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('size', query.size)
      .set('sort', `${query.sortBy},${query.sortOrder}`);

    if (query.userId !== null) {
      params = params.set('userId', query.userId);
    }
    if (query.categoryId !== null) {
      params = params.set('categoryId', query.categoryId);
    }
    if (query.subcategoryId !== null) {
      params = params.set('subcategoryId', query.subcategoryId);
    }
    if (query.from) {
      params = params.set('from', query.from);
    }
    if (query.to) {
      params = params.set('to', query.to);
    }

    return this.http.get<ListResponse<TransactionApiResponse[]>>('/api/transactions', { params }).pipe(
      map((response) => ({
        data: response.data.map((item) => this.mapTransaction(item)),
        total: response.total
      }))
    );
  }

  getCategories(): Observable<TransactionCategory[]> {
    const params = new HttpParams().set('size', 500);
    return this.http.get<ListResponse<CategoryApiResponse[]>>('/api/categories', { params }).pipe(
      map((response) => response.data.map((category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
        parentCategoryId: category.parentCategoryId,
        parentCategoryName: category.parentCategoryName,
        group: category.group
      })))
    );
  }

  getUsers(): Observable<TransactionUserOption[]> {
    return this.http.get<ApiResponse<UserApiResponse[]>>('/api/users?selectable=true').pipe(
      map((response) => response.data.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role
      })))
    );
  }

  private mapTransaction(item: TransactionApiResponse): TransactionItem {
    const amount = typeof item.amount === 'number' ? item.amount : Number(item.amount ?? 0);

    return {
      id: item.id,
      amount: Number.isNaN(amount) ? 0 : amount,
      type: item.type,
      fromAccountId: item.fromAccountId,
      fromAccountName: item.fromAccountName,
      toAccountId: item.toAccountId,
      toAccountName: item.toAccountName,
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      createdById: item.createdById,
      createdByUsername: item.createdByUsername,
      transactionDate: item.transactionDate,
      createdAt: item.createdAt,
      comment: item.comment
    };
  }
}
