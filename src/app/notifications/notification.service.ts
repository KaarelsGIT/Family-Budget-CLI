import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface NotificationItem {
  id: number;
  type: string;
  message: string;
  action: string | null;
  relatedCategoryId: number | null;
  relatedReminderId: number | null;
  relatedTransactionId: number | null;
  relatedAccountId: number | null;
  isRead: boolean;
  createdAt: string;
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
export class NotificationService {
  private readonly http = inject(HttpClient);

  getNotifications(): Observable<NotificationItem[]> {
    return this.http.get<ListResponse<NotificationItem[]>>(`${environment.apiUrl}/notifications?size=20`).pipe(
      map((response) => response.data)
    );
  }

  getUnreadCount(): Observable<number> {
    return this.http.get<ApiResponse<number>>(`${environment.apiUrl}/notifications/unread-count`).pipe(
      map((response) => response.data)
    );
  }

  markAllAsRead(): Observable<void> {
    return this.http.put<ApiResponse<string>>(`${environment.apiUrl}/notifications/read-all`, {}).pipe(
      map(() => void 0)
    );
  }

  deleteAll(): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/notifications`).pipe(
      map(() => void 0)
    );
  }
}
