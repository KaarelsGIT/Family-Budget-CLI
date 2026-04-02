import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RecurringReminderItem {
  id: number;
  recurringTransactionId: number;
  userId: number;
  username: string;
  categoryId: number;
  categoryName: string;
  accountId: number | null;
  accountName: string | null;
  amount: number | null;
  comment: string | null;
  dueDate: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  transactionType: 'INCOME' | 'EXPENSE' | 'TRANSFER';
}

interface ApiResponse<T> {
  data: T;
}

interface ListResponse<T> {
  data: T;
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class RecurringReminderService {
  private readonly http = inject(HttpClient);

  getReminders(): Observable<RecurringReminderItem[]> {
    return this.http.get<ListResponse<RecurringReminderItem[]>>(`${environment.apiUrl}/recurring-reminders`).pipe(
      map((response) => response.data)
    );
  }

  getReminder(id: number): Observable<RecurringReminderItem> {
    return this.http.get<ApiResponse<RecurringReminderItem>>(`${environment.apiUrl}/recurring-reminders/${id}`).pipe(
      map((response) => response.data)
    );
  }

  skipReminder(id: number): Observable<RecurringReminderItem> {
    return this.http.post<ApiResponse<RecurringReminderItem>>(`${environment.apiUrl}/recurring-reminders/${id}/skip`, {}).pipe(
      map((response) => response.data)
    );
  }
}
